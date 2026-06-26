import {
  HttpError,
  adminClient,
  rawBody,
  requireMethod,
  sendError,
  verifySlackSignature
} from './_lib/orbit-server.js';

function parsePayload(body) {
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new HttpError(400, 'Ogiltig Slack JSON-body.');
  }
}

async function findSlackIntegration(teamId) {
  if (!teamId) return null;
  const { data, error } = await adminClient()
    .from('integration_accounts')
    .select('*')
    .eq('provider', 'slack')
    .eq('provider_team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function alreadyStored(externalId) {
  if (!externalId) return false;
  const { data, error } = await adminClient()
    .from('integration_events')
    .select('id')
    .eq('provider', 'slack')
    .eq('external_id', externalId)
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function markSlackUninstalled(teamId) {
  if (!teamId) return;
  await adminClient()
    .from('integration_accounts')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('provider', 'slack')
    .eq('provider_team_id', teamId);
}

async function storeSlackEvent(payload, integration) {
  const event = payload.event || {};
  const externalId = payload.event_id || event.event_ts || event.ts || '';
  if (await alreadyStored(externalId)) return { duplicate: true };

  const { data, error } = await adminClient()
    .from('integration_events')
    .insert({
      provider: 'slack',
      integration_account_id: integration?.id || null,
      area_id: integration?.area_id || null,
      event_type: event.type || payload.type || 'unknown',
      external_id: externalId,
      payload,
      processed_at: null
    })
    .select()
    .single();
  if (error) throw error;
  return { event: data };
}

export default async function handler(req, res) {
  try {
    requireMethod(req, 'POST');
    const body = await rawBody(req);
    verifySlackSignature(req, body);
    const payload = parsePayload(body);

    if (payload.type === 'url_verification') {
      res.status(200).send(payload.challenge || '');
      return;
    }

    if (payload.type !== 'event_callback') {
      res.status(200).json({ ok: true, ignored: payload.type || 'unknown' });
      return;
    }

    const teamId = payload.team_id || payload.authorizations?.[0]?.team_id || '';
    const integration = await findSlackIntegration(teamId);
    if (payload.event?.type === 'app_uninstalled') await markSlackUninstalled(teamId);
    const result = await storeSlackEvent(payload, integration);

    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
}
