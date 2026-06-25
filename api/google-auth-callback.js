import {
  adminClient,
  appUrl,
  exchangeGoogleCode,
  loadIntegrationToken,
  sendError,
  storeIntegrationToken,
  verifyOAuthState
} from './_lib/orbit-server.js';

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function withStatus(url, status, message = '') {
  const target = new URL(url);
  target.searchParams.set('orbitCalendar', status);
  if (message) target.searchParams.set('message', message);
  return target.toString();
}

async function latestGoogleIntegration(userId) {
  const { data, error } = await adminClient()
    .from('integration_accounts')
    .select('*')
    .eq('owner_id', userId)
    .eq('provider', 'google_calendar')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

export default async function handler(req, res) {
  const fallback = appUrl(req);

  try {
    if (req.method !== 'GET') return sendError(res, { status: 405, message: `Metoden ${req.method} stöds inte här.` });
    if (req.query.error) return redirect(res, withStatus(fallback, 'error', String(req.query.error)));

    const state = verifyOAuthState(req.query.state);
    const code = String(req.query.code || '');
    if (!code) return redirect(res, withStatus(fallback, 'error', 'Google returnerade ingen kod.'));

    const freshToken = await exchangeGoogleCode(req, code);
    const existing = await latestGoogleIntegration(state.userId);
    const settings = {
      ...(existing?.settings || {}),
      calendarId: existing?.settings?.calendarId || 'primary',
      oauthGrantedAt: new Date().toISOString()
    };

    let integration = existing;
    if (integration) {
      const { data, error } = await adminClient()
        .from('integration_accounts')
        .update({
          display_name: integration.display_name || 'Google Calendar',
          scopes: freshToken.scope ? freshToken.scope.split(' ') : ['https://www.googleapis.com/auth/calendar.events'],
          settings,
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('id', integration.id)
        .select()
        .single();
      if (error) throw error;
      integration = data;
    } else {
      const { data, error } = await adminClient()
        .from('integration_accounts')
        .insert({
          provider: 'google_calendar',
          owner_id: state.userId,
          display_name: 'Google Calendar',
          scopes: freshToken.scope ? freshToken.scope.split(' ') : ['https://www.googleapis.com/auth/calendar.events'],
          settings,
          status: 'active'
        })
        .select()
        .single();
      if (error) throw error;
      integration = data;
    }

    let token = freshToken;
    if (!token.refresh_token && integration.token_ref) {
      const previous = await loadIntegrationToken(integration.id);
      token = { ...previous, ...freshToken, refresh_token: previous.refresh_token };
    }
    if (!token.refresh_token) throw new Error('Google returnerade ingen refresh token. Kör consent-flödet igen.');

    const tokenId = await storeIntegrationToken(integration, token);
    await adminClient()
      .from('integration_accounts')
      .update({ token_ref: `private.integration_tokens:${tokenId}`, status: 'active', updated_at: new Date().toISOString() })
      .eq('id', integration.id);

    return redirect(res, withStatus(state.returnTo || fallback, 'connected'));
  } catch (error) {
    if (res.headersSent) return;
    return redirect(res, withStatus(fallback, 'error', error.message || 'OAuth misslyckades.'));
  }
}
