import {
  HttpError,
  adminClient,
  getSlackPermalink,
  getSlackUserInfo,
  loadIntegrationToken,
  rawBody,
  requireMethod,
  sendError,
  verifySlackSignature
} from './_lib/orbit-server.js';

const CREATE_TASK_CALLBACKS = new Set(['orbit_create_task', 'create_orbit_task']);
const SLASH_HELP_ALIASES = new Set(['', 'help', 'hjälp', 'hjalp', '?']);

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

function parseFormBody(body) {
  return Object.fromEntries(new URLSearchParams(body || '').entries());
}

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function shortTitle(text, fallback = 'Slack-meddelande') {
  const clean = cleanText(text) || fallback;
  return clean.length > 90 ? `${clean.slice(0, 87)}…` : clean;
}

function initialsFromName(name = '') {
  return cleanText(name)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || '?';
}

function slackResponse(text, extra = {}) {
  return {
    response_type: 'ephemeral',
    text,
    ...extra
  };
}

function slashHelpText() {
  return [
    'Orbit slash command:',
    '• `/orbit Svara på offerten #idag p1` skapar en task i din Orbit Inbox.',
    '• `/orbit <@person> Följ upp avtalet #sen p2` tilldelar tasken till personen om Slack-emailen matchar en Orbit-teammedlem.',
    '• Bucket: `#idag`, `#sen`, `#someday`.',
    '• Prioritet: `p1`, `p2`, `p3` eller `!!!`, `!!`, `!`.'
  ].join('\n');
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
  const { data, error } = await adminClient().from('tasks').select('id,title').eq('id', id).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

function slackUserName(slackUser, fallback = '') {
  return cleanText(
    slackUser?.profile?.real_name ||
    slackUser?.profile?.display_name ||
    slackUser?.real_name ||
    slackUser?.name ||
    fallback
  );
}

async function findAuthUserByEmail(email) {
  const normalized = cleanText(email).toLowerCase();
  if (!normalized) return null;

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await adminClient().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users || [];
    const match = users.find(user => cleanText(user.email).toLowerCase() === normalized);
    if (match || users.length < 1000) return match || null;
  }
  return null;
}

async function ensureProfileForUser(user, fallbackName = '') {
  if (!user?.id) return null;
  const { data: existing, error: readError } = await adminClient()
    .from('profiles')
    .select('id,name')
    .eq('id', user.id)
    .limit(1);
  if (readError) throw readError;
  if (existing?.[0]) return existing[0];

  const name = cleanText(fallbackName) || cleanText(user.email).split('@')[0] || 'Orbit-användare';
  const { data, error } = await adminClient()
    .from('profiles')
    .insert({ id: user.id, name, initials: initialsFromName(name) })
    .select('id,name')
    .single();
  if (error) throw error;
  return data;
}

async function sharesOrbitTeam(userId, ownerId) {
  if (!userId || !ownerId || userId === ownerId) return Boolean(userId && ownerId);
  const { data, error } = await adminClient()
    .from('team_members')
    .select('team_id,user_id')
    .in('user_id', [userId, ownerId])
    .eq('status', 'active');
  if (error) throw error;
  const ownerTeams = new Set((data || []).filter(row => row.user_id === ownerId).map(row => row.team_id));
  return (data || []).some(row => row.user_id === userId && ownerTeams.has(row.team_id));
}

async function resolveSlackUser({ integration, token, slackUserId, slackUserName: fallbackName = '', fallbackSource = 'integration_owner', fallbackUserId = '' }) {
  const fallback = {
    userId: fallbackUserId || integration.owner_id,
    source: fallbackSource,
    slackUserId: slackUserId || '',
    slackUserEmail: '',
    slackUserName: fallbackName || ''
  };
  if (!token || !slackUserId) return fallback;

  try {
    const slackUser = await getSlackUserInfo({ token, userId: slackUserId });
    const email = cleanText(slackUser?.profile?.email).toLowerCase();
    const name = slackUserName(slackUser, fallbackName || slackUserId);
    if (!email) return { ...fallback, source: 'slack_user_without_email', slackUserName: name };

    const authUser = await findAuthUserByEmail(email);
    if (!authUser) return { ...fallback, source: 'slack_email_unmatched', slackUserEmail: email, slackUserName: name };

    const allowed = await sharesOrbitTeam(authUser.id, integration.owner_id);
    if (!allowed) return { ...fallback, source: 'slack_email_matched_without_shared_team', slackUserEmail: email, slackUserName: name };

    const profile = await ensureProfileForUser(authUser, name);
    return {
      userId: profile?.id || authUser.id,
      source: 'slack_email',
      slackUserId,
      slackUserEmail: email,
      slackUserName: name
    };
  } catch (error) {
    return { ...fallback, source: 'slack_user_lookup_failed', lookupError: error.message || 'Slack user lookup misslyckades.' };
  }
}

async function resolveShortcutUser(payload, integration, token) {
  return resolveSlackUser({
    integration,
    token,
    slackUserId: payload.user?.id || '',
    slackUserName: payload.user?.name || '',
    fallbackSource: 'integration_owner'
  });
}

function parseSlashTask(text = '') {
  const raw = cleanText(text);
  const lower = raw.toLowerCase();
  if (SLASH_HELP_ALIASES.has(lower)) return { help: true };

  const mention = raw.match(/<@([A-Z0-9]+)(?:\|[^>]+)?>/i);
  const assigneeSlackUserId = mention?.[1] || '';

  let priority = 3;
  if (/\bp1\b|\bprio\s*1\b|!!!|\burgent\b|\bakut\b|\bhög\b/i.test(raw)) priority = 1;
  else if (/\bp2\b|\bprio\s*2\b|!!|\bmedium\b|\bmedel\b/i.test(raw)) priority = 2;
  else if (/\bp3\b|\bprio\s*3\b|!|\blåg\b/i.test(raw)) priority = 3;

  let bucket = 'inbox';
  if (/(^|\s)#?(idag|today)(\s|$)/i.test(raw)) bucket = 'today';
  if (/(^|\s)#?(sen|later)(\s|$)/i.test(raw)) bucket = 'later';
  if (/(^|\s)#?(someday|någon-gång|nagon-gang|nån-gång|nan-gang)(\s|$)/i.test(raw)) bucket = 'someday';

  const title = cleanText(raw
    .replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/ig, '')
    .replace(/\b(p[123]|prio\s*[123])\b/ig, '')
    .replace(/!!!|!!|!/g, '')
    .replace(/(^|\s)#(idag|today|sen|later|someday|någon-gång|nagon-gang|nån-gång|nan-gang)(?=\s|$)/ig, ' ')
  );

  return {
    help: false,
    title: title || raw || 'Ny Slack-uppgift',
    priority,
    bucket,
    assigneeSlackUserId
  };
}

function slashChannelLink(command) {
  if (!command.team_id || !command.channel_id) return '';
  return `slack://channel?team=${encodeURIComponent(command.team_id)}&id=${encodeURIComponent(command.channel_id)}`;
}

async function createTaskFromSlashCommand(command, integration) {
  const parsed = parseSlashTask(command.text || '');
  if (parsed.help) return { help: true };

  let token = null;
  try {
    token = await loadIntegrationToken(integration.id);
  } catch {
    token = null;
  }

  const actor = await resolveSlackUser({
    integration,
    token,
    slackUserId: command.user_id || '',
    slackUserName: command.user_name || '',
    fallbackSource: 'integration_owner'
  });
  const createdBy = actor.userId || integration.owner_id;

  const assignee = parsed.assigneeSlackUserId
    ? await resolveSlackUser({
        integration,
        token,
        slackUserId: parsed.assigneeSlackUserId,
        slackUserName: parsed.assigneeSlackUserId,
        fallbackSource: 'slash_assignee_unmatched',
        fallbackUserId: createdBy
      })
    : actor;

  const assigneeId = assignee.userId || createdBy;
  const now = new Date().toISOString();
  const channelLink = slashChannelLink(command);
  const notes = [
    `Skapad från Slack slash command${command.channel_name ? ` · #${command.channel_name}` : ''}`,
    command.text ? `Slack-command:\n/orbit ${command.text}` : '',
    command.user_id ? `Skapad från Slack av: ${command.user_name || command.user_id}` : '',
    actor.slackUserEmail ? `Skaparens Slack-email matchad mot Orbit: ${actor.slackUserEmail}` : '',
    assignee.slackUserEmail && assignee.slackUserEmail !== actor.slackUserEmail ? `Tilldelad via Slack-email: ${assignee.slackUserEmail}` : '',
    `Orbit-skapare: ${actor.source}`,
    `Orbit-tilldelning: ${assignee.source}`
  ].filter(Boolean).join('\n\n');

  const { data: task, error: taskError } = await adminClient()
    .from('tasks')
    .insert({
      title: shortTitle(parsed.title, 'Slack: ny uppgift'),
      notes,
      project_id: null,
      created_by: createdBy,
      assignee_id: assigneeId,
      bucket: parsed.bucket,
      priority: parsed.priority,
      status: 'todo',
      task_type: 'task',
      activation_mode: 'all',
      visible: true
    })
    .select()
    .single();
  if (taskError) throw taskError;

  if (channelLink) {
    const { error: linkError } = await adminClient().from('task_links').insert({
      task_id: task.id,
      created_by: createdBy,
      kind: 'chat',
      provider: 'Slack',
      title: command.channel_name ? `Slack #${command.channel_name}` : 'Slack-kanal',
      url: channelLink,
      external_id: command.channel_id || '',
      metadata: {
        source: 'slash_command',
        teamId: command.team_id || '',
        channelId: command.channel_id || '',
        actorSlackUserId: command.user_id || '',
        assigneeSlackUserId: parsed.assigneeSlackUserId || '',
        orbitCreatedBy: createdBy,
        orbitAssigneeId: assigneeId,
        actorSource: actor.source,
        assigneeSource: assignee.source
      }
    });
    if (linkError) throw linkError;
  }

  const { error: eventError } = await adminClient().from('integration_events').insert({
    provider: 'slack',
    integration_account_id: integration.id,
    area_id: integration.area_id || null,
    event_type: 'slash_command',
    external_id: `slash:${command.team_id || ''}:${command.channel_id || ''}:${command.user_id || ''}:${command.trigger_id || now}`,
    payload: {
      command,
      orbit: {
        taskId: task.id,
        createdBy,
        assigneeId,
        actorSource: actor.source,
        assigneeSource: assignee.source,
        actorSlackUserEmail: actor.slackUserEmail || '',
        assigneeSlackUserEmail: assignee.slackUserEmail || '',
        processedAt: now,
        action: 'created_task_from_slash_command'
      }
    },
    processed_at: now
  });
  if (eventError) throw eventError;

  return { task, parsed, actor, assignee, createdBy, assigneeId };
}

async function handleSlashCommand(command, res) {
  try {
    if (command.command && command.command !== '/orbit') {
      res.status(200).json(slackResponse('Orbit: okänt kommando. Använd `/orbit help`.'));
      return;
    }
    if (parseSlashTask(command.text || '').help) {
      res.status(200).json(slackResponse(slashHelpText()));
      return;
    }

    const integration = await findSlackIntegration(command.team_id || '');
    if (!integration) {
      res.status(200).json(slackResponse('Orbit är inte anslutet till den här Slack-workspacen ännu.'));
      return;
    }

    const result = await createTaskFromSlashCommand(command, integration);
    if (result.help) {
      res.status(200).json(slackResponse(slashHelpText()));
      return;
    }

    const assignedText = result.assignee.source === 'slack_email' && result.assigneeId !== result.createdBy
      ? ` och tilldelade den till ${result.assignee.slackUserName || 'vald person'}`
      : result.assignee.source === 'slack_email'
        ? ' i din Orbit Inbox'
        : ' i Orbit Inbox';
    res.status(200).json(slackResponse(`Orbit: skapade “${result.task.title}”${assignedText}.`));
  } catch (error) {
    res.status(200).json(slackResponse(`Orbit: kunde inte skapa uppgiften. ${error.message || 'Okänt fel.'}`));
  }
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
  if (existing?.task_id) return { task: await loadTask(existing.task_id) || { id: existing.task_id, title: existing.text_snapshot || 'Slack-uppgift' }, duplicate: true };

  let token = null;
  try {
    token = await loadIntegrationToken(integration.id);
  } catch {
    token = null;
  }
  const shortcutUser = await resolveShortcutUser(payload, integration, token);
  const orbitUserId = shortcutUser.userId || integration.owner_id;

  let permalink = existing?.permalink || (payload.team?.id ? `slack://channel?team=${encodeURIComponent(payload.team.id)}&id=${encodeURIComponent(channelId)}&message=${encodeURIComponent(messageTs)}` : '');
  if (!permalink) {
    try {
      permalink = await getSlackPermalink({ token, channel: channelId, messageTs });
    } catch {
      permalink = '';
    }
  } else {
    try {
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
    user.id ? `Skapad från Slack av: ${user.name || user.id}` : '',
    shortcutUser.slackUserEmail ? `Slack-email matchad mot Orbit: ${shortcutUser.slackUserEmail}` : '',
    `Orbit-tilldelning: ${shortcutUser.source}`
  ].filter(Boolean).join('\n\n');

  const { data: task, error: taskError } = await adminClient()
    .from('tasks')
    .insert({
      title,
      notes,
      project_id: null,
      created_by: orbitUserId,
      assignee_id: orbitUserId,
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
      created_by: orbitUserId,
      kind: 'chat',
      provider: 'Slack',
      title: 'Slack-meddelande',
      url: permalink,
      external_id: messageTs,
      metadata: {
        slackUserId: user.id || '',
        slackUserEmail: shortcutUser.slackUserEmail || '',
        orbitUserId,
        assigneeSource: shortcutUser.source,
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
      shortcutUserEmail: shortcutUser.slackUserEmail || '',
      orbitUserId,
      assigneeSource: shortcutUser.source,
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
        assigneeId: orbitUserId,
        assigneeSource: shortcutUser.source,
        slackUserEmail: shortcutUser.slackUserEmail || '',
        processedAt: now,
        action: 'created_task_from_message_shortcut',
        slackPermalink: permalink || ''
      }
    },
    processed_at: now
  });
  if (eventError) throw eventError;

  return { task, duplicate: false, assigneeSource: shortcutUser.source };
}

export default async function handler(req, res) {
  try {
    requireMethod(req, 'POST');
    const body = await rawBody(req);
    verifySlackSignature(req, body);

    const form = parseFormBody(body);
    if (form.command) {
      await handleSlashCommand(form, res);
      return;
    }

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
      : `Orbit: skapade uppgiften “${result.task.title}”${result.assigneeSource === 'slack_email' ? ' i din Orbit Inbox' : ' i Orbit Inbox'}.`;
    await postSlackResponse(payload.response_url, text);
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
}
