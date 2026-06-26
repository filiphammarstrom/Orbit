import {
  HttpError,
  adminClient,
  getSlackPermalink,
  loadIntegrationToken,
  rawBody,
  requireMethod,
  sendError,
  verifySlackSignature
} from './_lib/orbit-server.js';

const CREATE_TASK_CALLBACKS = new Set(['orbit_create_task', 'create_orbit_task']);

function parseInteraction(body) {
  const params = new URLSearchParams(body || '');
  const rawPayload = params.get('payload');
  if (!rawPayload) throw new HttpError(400, 'Slack-payload saknas.');
  try {
    return JSON.parse(rawPayload);
  } catch {
    throw new HttpError(400, 'Ogiltig Slack interaction-payload.');
  }
}

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function shortTitle(text, fallback = 'Slack-meddelande') {
  const clean = cleanText(text) || fallback;
  return clean.length > 90 ? `${clean.slice(0, 87)}…` : clean;
}

async function postSlackResponse(responseUrl, text) {
  if (!responseUrl) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        response_type: 'ephemeral',
        replace_original: false,
        text
      })
    });
  } catch {
    // Slack interaction acknowledgments must stay resilient. The task creation
    // should not fail just because the optional confirmation response failed.
  } finally {
    clearTimeout(timeout);
  }
}

async function findSlackIntegration(teamId) {
  if (!teamId) return null;
  const { data, error } = await adminClient()
    .from('integration_accounts')
    .select('*')
    .eq('provider', 'slack')
    .eq('provider_team_id', teamId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function existingSlackLink(integrationId, channelId, messageTs) {
  const { data, error } = await adminClient()
    .from('slack_message_links')
    .select('*')
    .eq('integration_account_id', integrationId)
    .eq('channel_id', channelId)
    .eq('message_ts', messageTs)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function loadTask(id) {
  if (!id) return null;
  const { data, error } = await adminClient().from('tasks').select('id,title').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function createTaskFromMessage(payload, integration) {
  const message = payload.message || {};
  const channel = payload.channel || {};
  const user = payload.user || {};
  const channelId = channel.id || message.channel || '';
  const messageTs = message.ts || '';
  const threadTs = message.thread_ts || messageTs;
  if (!channelId || !messageTs) throw new HttpError(400, 'Slack-meddelandets kanal eller timestamp saknas.');

  const existing = await existingSlackLink(integration.id, channelId, messageTs);
  if (existing?.task_id) return { task: await loadTask(existing.task_id), duplicate: true };

  let permalink = existing?.permalink || (payload.team?.id ? `slack://channel?team=${encodeURIComponent(payload.team.id)}&id=${encodeURIComponent(channelId)}&message=${encodeURIComponent(messageTs)}` : '');
  if (!permalink) {
    try {
      const token = await loadIntegrationToken(integration.id);
      permalink = await getSlackPermalink({ token, channel: channelId, messageTs });
    } catch {
      permalink = '';
    }
  } else {
    try {
      const token = await loadIntegrationToken(integration.id);
      permalink = await getSlackPermalink({ token, channel: channelId, messageTs }) || permalink;
    } catch {
      // Keep the deep link fallback if Slack cannot return an HTTP permalink.
    }
  }

  const now = new Date().toISOString();
  const title = shortTitle(message.text, 'Slack: nytt meddelande');
  const notes = [
    message.text ? `Slack-meddelande:\n${message.text}` : '',
    `Källa: Slack shortcut${channel.name ? ` · #${channel.name}` : ''}`,
    `Slack-kanal: ${channelId}`,
    `Slack message_ts: ${messageTs}`,
    user.id ? `Skapad från Slack av: ${user.name || user.id}` : ''
  ].filter(Boolean).join('\n\n');

  const { data: task, error: taskError } = await adminClient()
    .from('tasks')
    .insert({
      title,
      notes,
      project_id: null,
      created_by: integration.owner_id,
      assignee_id: integration.owner_id,
      bucket: 'inbox',
      priority: 3,
      status: 'todo',
      task_type: 'task',
      activation_mode: 'all',
      visible: true
    })
    .select()
    .single();
  if (taskError) throw taskError;

  if (permalink) {
    const { error: linkError } = await adminClient().from('task_links').insert({
      task_id: task.id,
      created_by: integration.owner_id,
      kind: 'chat',
      provider: 'Slack',
      title: 'Slack-meddelande',
      url: permalink,
      external_id: messageTs,
      metadata: {
        slackUserId: user.id || '',
        channelId,
        threadTs,
        callbackId: payload.callback_id || ''
      }
    });
    if (linkError) throw linkError;
  }

  const { error: slackLinkError } = await adminClient().from('slack_message_links').upsert({
    task_id: task.id,
    integration_account_id: integration.id,
    channel_id: channelId,
    message_ts: messageTs,
    thread_ts: threadTs || '',
    permalink: permalink || '',
    author_external_id: message.user || user.id || '',
    text_snapshot: message.text || '',
    metadata: {
      source: 'message_shortcut',
      shortcutUserId: user.id || '',
      shortcutUserName: user.name || '',
      callbackId: payload.callback_id || ''
    }
  }, { onConflict: 'integration_account_id,channel_id,message_ts' });
  if (slackLinkError) throw slackLinkError;

  const { error: eventError } = await adminClient().from('integration_events').insert({
    provider: 'slack',
    integration_account_id: integration.id,
    area_id: integration.area_id || null,
    event_type: 'message_shortcut',
    external_id: `shortcut:${payload.team?.id || ''}:${channelId}:${messageTs}:${payload.action_ts || now}`,
    payload: {
      ...payload,
      orbit: {
        taskId: task.id,
        processedAt: now,
        action: 'created_task_from_message_shortcut',
        slackPermalink: permalink || ''
      }
    },
    processed_at: now
  });
  if (eventError) throw eventError;

  return { task, duplicate: false };
}

export default async function handler(req, res) {
  try {
    requireMethod(req, 'POST');
    const body = await rawBody(req);
    verifySlackSignature(req, body);
    const payload = parseInteraction(body);

    if (payload.type !== 'message_action') {
      res.status(200).json({ ok: true, ignored: payload.type || 'unknown' });
      return;
    }
    if (!CREATE_TASK_CALLBACKS.has(payload.callback_id)) {
      res.status(200).json({ ok: true, ignored: payload.callback_id || 'unknown_callback' });
      return;
    }

    const integration = await findSlackIntegration(payload.team?.id || payload.user?.team_id || '');
    if (!integration) {
      await postSlackResponse(payload.response_url, 'Orbit är inte anslutet till den här Slack-workspacen ännu.');
      res.status(200).json({ ok: true, error: 'missing_integration' });
      return;
    }

    const result = await createTaskFromMessage(payload, integration);
    const text = result.duplicate
      ? `Orbit: det här Slack-meddelandet finns redan som uppgift: ${result.task.title || result.task.id}`
      : `Orbit: skapade uppgiften “${result.task.title}”.`;
    await postSlackResponse(payload.response_url, text);
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
}
