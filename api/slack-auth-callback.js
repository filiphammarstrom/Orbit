import {
  adminClient,
  appUrl,
  exchangeSlackCode,
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
  target.searchParams.set('orbitSlack', status);
  if (message) target.searchParams.set('message', message);
  return target.toString();
}

async function latestSlackIntegration(userId, teamId) {
  let query = adminClient()
    .from('integration_accounts')
    .select('*')
    .eq('owner_id', userId)
    .eq('provider', 'slack');
  if (teamId) query = query.eq('provider_team_id', teamId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

function slackSettings(token, existing = {}) {
  return {
    ...(existing || {}),
    appId: token.app_id || existing?.appId || '',
    botUserId: token.bot_user_id || existing?.botUserId || '',
    teamName: token.team?.name || existing?.teamName || '',
    enterpriseId: token.enterprise?.id || existing?.enterpriseId || '',
    enterpriseName: token.enterprise?.name || existing?.enterpriseName || '',
    installedAt: new Date().toISOString()
  };
}

export default async function handler(req, res) {
  const fallback = appUrl(req);

  try {
    if (req.method !== 'GET') return sendError(res, { status: 405, message: `Metoden ${req.method} stöds inte här.` });
    if (req.query.error) return redirect(res, withStatus(fallback, 'error', String(req.query.error)));

    const state = verifyOAuthState(req.query.state);
    if (state.provider && state.provider !== 'slack') throw new Error('Fel OAuth-provider.');
    const code = String(req.query.code || '');
    if (!code) return redirect(res, withStatus(fallback, 'error', 'Slack returnerade ingen kod.'));

    const token = await exchangeSlackCode(req, code);
    const teamId = token.team?.id || '';
    const existing = await latestSlackIntegration(state.userId, teamId);
    const row = {
      provider: 'slack',
      owner_id: state.userId,
      provider_user_id: token.authed_user?.id || token.bot_user_id || '',
      provider_team_id: teamId,
      display_name: token.team?.name ? `Slack · ${token.team.name}` : 'Slack',
      scopes: token.scope ? token.scope.split(',').filter(Boolean) : [],
      settings: slackSettings(token, existing?.settings),
      status: 'active',
      updated_at: new Date().toISOString()
    };

    let integration = existing;
    if (integration) {
      const { data, error } = await adminClient()
        .from('integration_accounts')
        .update(row)
        .eq('id', integration.id)
        .select()
        .single();
      if (error) throw error;
      integration = data;
    } else {
      const { data, error } = await adminClient()
        .from('integration_accounts')
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      integration = data;
    }

    const tokenId = await storeIntegrationToken(integration, token);
    await adminClient()
      .from('integration_accounts')
      .update({ token_ref: `private.integration_tokens:${tokenId}`, status: 'active', updated_at: new Date().toISOString() })
      .eq('id', integration.id);

    return redirect(res, withStatus(state.returnTo || fallback, 'connected'));
  } catch (error) {
    if (res.headersSent) return;
    return redirect(res, withStatus(fallback, 'error', error.message || 'Slack OAuth misslyckades.'));
  }
}
