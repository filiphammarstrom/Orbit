import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
const DEFAULT_SLACK_SCOPES = [
  'channels:history',
  'commands',
  'groups:history',
  'im:history',
  'mpim:history',
  'reactions:read',
  'team:read',
  'chat:write',
  'users:read',
  'users:read.email'
];
let cachedAdmin;
let cachedUserKey;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new HttpError(500, `Saknar serverkonfiguration: ${name}`);
  return value;
}

export function requireAnyEnv(names) {
  const entry = names.find(name => process.env[name]);
  if (!entry) throw new HttpError(500, `Saknar serverkonfiguration: ${names.join(' eller ')}`);
  return process.env[entry];
}

export function adminClient() {
  if (!cachedAdmin) {
    cachedAdmin = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return cachedAdmin;
}

export function bearerToken(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

function supabaseUserKey() {
  if (!cachedUserKey) {
    cachedUserKey = requireAnyEnv([
      'SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_ANON_KEY',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      'VITE_SUPABASE_ANON_KEY'
    ]);
  }
  return cachedUserKey;
}

export function userClient(req) {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, 'Saknar inloggnings-token.');
  return createClient(requireEnv('SUPABASE_URL'), supabaseUserKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { authorization: `Bearer ${token}` } }
  });
}

export function sendError(res, error) {
  const status = error.status || 500;
  res.status(status).json({ error: error.message || 'Okänt serverfel.' });
}

export function requireMethod(req, method) {
  if (req.method !== method) throw new HttpError(405, `Metoden ${req.method} stöds inte här.`);
}

export function appUrl(req) {
  return (process.env.APP_URL || `https://${req.headers.host}`).replace(/\/$/, '');
}

export function googleRedirectUri(req) {
  return process.env.GOOGLE_REDIRECT_URI || `${appUrl(req)}/api/google-auth-callback`;
}

export function slackRedirectUri(req) {
  return process.env.SLACK_REDIRECT_URI || `${appUrl(req)}/api/slack-auth-callback`;
}

export async function authenticatedUser(req) {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, 'Saknar inloggnings-token.');

  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Ogiltig inloggning.');
  return data.user;
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function signOAuthState(payload) {
  const body = base64urlJson(payload);
  const signature = createHmac('sha256', requireEnv('OAUTH_STATE_SECRET')).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyOAuthState(state) {
  const [body, signature] = String(state || '').split('.');
  if (!body || !signature) throw new HttpError(400, 'Ogiltig OAuth-state.');

  const expected = createHmac('sha256', requireEnv('OAUTH_STATE_SECRET')).update(body).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  const valid = signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
  if (!valid) throw new HttpError(400, 'OAuth-state kunde inte verifieras.');

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp < Date.now()) throw new HttpError(400, 'OAuth-state har gått ut.');
  return payload;
}

export function googleAuthUrl(req, user) {
  const state = signOAuthState({
    userId: user.id,
    returnTo: appUrl(req),
    exp: Date.now() + 10 * 60 * 1000
  });
  const params = new URLSearchParams({
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    redirect_uri: googleRedirectUri(req),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state
  });
  if (user.email) params.set('login_hint', user.email);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function slackScopes() {
  return (process.env.SLACK_SCOPES || DEFAULT_SLACK_SCOPES.join(','))
    .split(',')
    .map(scope => scope.trim())
    .filter(Boolean);
}

export function slackAuthUrl(req, user) {
  const state = signOAuthState({
    provider: 'slack',
    userId: user.id,
    returnTo: appUrl(req),
    exp: Date.now() + 10 * 60 * 1000
  });
  const params = new URLSearchParams({
    client_id: requireEnv('SLACK_CLIENT_ID'),
    redirect_uri: slackRedirectUri(req),
    scope: slackScopes().join(','),
    state
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function exchangeGoogleCode(req, code) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
      redirect_uri: googleRedirectUri(req),
      grant_type: 'authorization_code'
    })
  });

  const token = await response.json();
  if (!response.ok) throw new HttpError(400, token.error_description || token.error || 'Google OAuth misslyckades.');
  return normalizeGoogleToken(token);
}

export async function exchangeSlackCode(req, code) {
  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('SLACK_CLIENT_ID'),
      client_secret: requireEnv('SLACK_CLIENT_SECRET'),
      code,
      redirect_uri: slackRedirectUri(req)
    })
  });

  const token = await response.json();
  if (!response.ok || !token.ok) throw new HttpError(400, token.error || 'Slack OAuth misslyckades.');
  return token;
}

export async function refreshGoogleToken(integration, token) {
  if (token.access_token && token.expires_at && token.expires_at > Date.now() + 2 * 60 * 1000) return token;
  if (!token.refresh_token) throw new HttpError(400, 'Google-kopplingen saknar refresh token.');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token'
    })
  });

  const refreshed = await response.json();
  if (!response.ok) throw new HttpError(400, refreshed.error_description || refreshed.error || 'Kunde inte förnya Google-token.');
  const next = normalizeGoogleToken({ ...token, ...refreshed, refresh_token: refreshed.refresh_token || token.refresh_token });
  await storeIntegrationToken(integration, next);
  return next;
}

function normalizeGoogleToken(token) {
  const expiresIn = Number(token.expires_in || 3600);
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    scope: token.scope || '',
    token_type: token.token_type || 'Bearer',
    expires_at: token.expires_at || Date.now() + expiresIn * 1000
  };
}

function encryptionKey() {
  return createHash('sha256').update(requireAnyEnv(['INTEGRATION_TOKEN_ENCRYPTION_KEY', 'GOOGLE_TOKEN_ENCRYPTION_KEY'])).digest();
}

export function encryptToken(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    encrypted_payload: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

export function decryptToken(row) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(row.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(row.encrypted_payload, 'base64')),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}

export async function storeIntegrationToken(integration, token) {
  const encrypted = encryptToken(token);
  const { data, error } = await adminClient().rpc('store_integration_token', {
    p_integration_account_id: integration.id,
    p_provider: integration.provider,
    p_owner_id: integration.owner_id,
    p_encrypted_payload: encrypted.encrypted_payload,
    p_iv: encrypted.iv,
    p_tag: encrypted.tag
  });
  if (error) throw new HttpError(500, error.message);
  return data;
}

export async function loadIntegrationToken(integrationId) {
  const { data, error } = await adminClient().rpc('get_integration_token', {
    p_integration_account_id: integrationId
  });
  if (error) throw new HttpError(500, error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new HttpError(400, 'Integrationens token saknas.');
  return decryptToken(row);
}

function slackAccessToken(token) {
  return token?.access_token || token?.bot?.bot_access_token || token?.authed_user?.access_token || '';
}

export async function getSlackPermalink({ token, channel, messageTs }) {
  if (!channel || !messageTs) return '';
  const accessToken = slackAccessToken(token);
  if (!accessToken) throw new HttpError(400, 'Slack-kopplingen saknar bot token.');

  const url = new URL('https://slack.com/api/chat.getPermalink');
  url.searchParams.set('channel', channel);
  url.searchParams.set('message_ts', messageTs);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new HttpError(response.status || 400, data.error || 'Kunde inte hämta Slack-länk.');
    return data.permalink || '';
  } finally {
    clearTimeout(timeout);
  }
}

export async function getSlackUserInfo({ token, userId }) {
  if (!userId) return null;
  const accessToken = slackAccessToken(token);
  if (!accessToken) throw new HttpError(400, 'Slack-kopplingen saknar bot token.');

  const url = new URL('https://slack.com/api/users.info');
  url.searchParams.set('user', userId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new HttpError(response.status || 400, data.error || 'Kunde inte hämta Slack-användare.');
    return data.user || null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createGoogleCalendarEvent({ accessToken, calendarId, event }) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(event)
  });
  const data = await response.json();
  if (response.status === 409 && event.id) {
    const existing = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}`, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    const existingData = await existing.json();
    if (existing.ok) return existingData;
  }
  if (!response.ok) throw new HttpError(response.status, data.error?.message || 'Kunde inte skapa Google Calendar-event.');
  return data;
}

export async function rawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length) return Buffer.concat(chunks).toString('utf8');
  return req.body ? JSON.stringify(req.body) : '';
}

export function verifySlackSignature(req, body) {
  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];
  if (!timestamp || !signature) throw new HttpError(401, 'Slack-signatur saknas.');
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) throw new HttpError(401, 'Slack-signaturen är för gammal.');

  const base = `v0:${timestamp}:${body}`;
  const expected = `v0=${createHmac('sha256', requireEnv('SLACK_SIGNING_SECRET')).update(base).digest('hex')}`;
  const signatureBuffer = Buffer.from(String(signature));
  const expectedBuffer = Buffer.from(expected);
  const valid = signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
  if (!valid) throw new HttpError(401, 'Slack-signaturen kunde inte verifieras.');
}
