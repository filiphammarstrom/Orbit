import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

const camelTask = t => ({
  id: t.id,
  title: t.title,
  notes: t.notes,
  projectId: t.project_id,
  createdBy: t.created_by,
  assigneeId: t.assignee_id,
  parentTaskId: t.parent_task_id,
  bucket: t.bucket,
  priority: t.priority,
  due: t.due_text || '',
  dueAt: t.due_at,
  reminderAt: t.reminder_at,
  completed: t.completed,
  visible: t.visible,
  status: t.status || 'todo',
  taskType: t.task_type || 'task',
  activationMode: t.activation_mode || 'all',
  activatedAt: t.activated_at,
  activationReason: t.activation_reason,
  recurrenceRule: t.recurrence_rule,
  trigger: t.trigger_type ? {
    type: t.trigger_type,
    taskId: t.trigger_task_id,
    event: t.trigger_event,
    label: t.trigger_type === 'task_completed' ? 'Väntar på föregående uppgift' : `Väntar på ${t.trigger_event}`
  } : null
});

const camelLink = l => ({
  id: l.id,
  taskId: l.task_id,
  kind: l.kind || 'other',
  provider: l.provider || '',
  title: l.title || '',
  url: l.url || '',
  externalId: l.external_id || '',
  metadata: l.metadata || {},
  createdBy: l.created_by,
  createdAt: l.created_at
});

const camelIntegration = i => ({
  id: i.id,
  provider: i.provider,
  ownerId: i.owner_id,
  teamId: i.team_id,
  areaId: i.area_id,
  providerUserId: i.provider_user_id || '',
  providerTeamId: i.provider_team_id || '',
  displayName: i.display_name || '',
  scopes: i.scopes || [],
  tokenRef: i.token_ref || '',
  settings: i.settings || {},
  status: i.status || 'needs_auth',
  lastSyncedAt: i.last_synced_at,
  createdAt: i.created_at,
  updatedAt: i.updated_at
});

const camelCalendarLink = l => ({
  id: l.id,
  taskId: l.task_id,
  integrationAccountId: l.integration_account_id,
  calendarId: l.calendar_id || 'primary',
  providerEventId: l.provider_event_id || '',
  eventUrl: l.event_url || '',
  syncDirection: l.sync_direction || 'orbit_to_calendar',
  status: l.status || 'pending',
  startAt: l.start_at,
  endAt: l.end_at,
  timeZone: l.time_zone || 'Europe/Stockholm',
  payload: l.payload || {},
  lastSyncedAt: l.last_synced_at,
  createdAt: l.created_at,
  updatedAt: l.updated_at
});

const camelIntegrationEvent = e => ({
  id: e.id,
  provider: e.provider,
  integrationAccountId: e.integration_account_id,
  areaId: e.area_id,
  eventType: e.event_type,
  externalId: e.external_id || '',
  payload: e.payload || {},
  processedAt: e.processed_at,
  createdAt: e.created_at
});

const cleanLinks = links => (Array.isArray(links) ? links : [])
  .map(link => ({
    kind: link.kind || 'other',
    provider: link.provider || '',
    title: link.title || '',
    url: link.url || '',
    external_id: link.externalId || link.external_id || '',
    metadata: link.metadata || {}
  }))
  .filter(link => link.url.trim() || link.external_id.trim() || link.title.trim());

const nullableIso = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export async function session() {
  if (!configured) return null;
  return (await supabase.auth.getSession()).data.session;
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(name, email, password) {
  const { error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function loadCloudState() {
  const [
    profiles,
    teams,
    members,
    areas,
    projects,
    tasks,
    dependencies,
    comments,
    notifications,
    activity,
    approvals,
    taskLinks,
    dailyBriefs,
    agentRuns,
    invitations,
    integrations,
    calendarLinks,
    integrationEvents
  ] = await Promise.all([
    supabase.from('profiles').select('*'),
    supabase.from('teams').select('*'),
    supabase.from('team_members').select('*'),
    supabase.from('areas').select('*').order('created_at'),
    supabase.from('projects').select('*').is('archived_at', null).order('created_at'),
    supabase.from('tasks').select('*').order('created_at', { ascending: false }),
    supabase.from('task_dependencies').select('*'),
    supabase.from('comments').select('*').order('created_at'),
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(300),
    supabase.from('approvals').select('*'),
    supabase.from('task_links').select('*').order('created_at', { ascending: false }),
    supabase.from('daily_briefs').select('*').order('created_at', { ascending: false }).limit(30),
    supabase.from('agent_runs').select('*').order('created_at', { ascending: false }).limit(30),
    supabase.from('invitations').select('*').order('expires_at', { ascending: false }),
    supabase.from('integration_accounts').select('*').order('created_at', { ascending: false }),
    supabase.from('task_calendar_links').select('*').order('created_at', { ascending: false }),
    supabase.from('integration_events').select('*').order('created_at', { ascending: false }).limit(100)
  ]);

  const failed = [profiles, teams, members, areas, projects, tasks, dependencies, comments, notifications, activity, approvals, taskLinks, dailyBriefs, agentRuns, invitations, integrations, calendarLinks, integrationEvents].find(r => r.error);
  if (failed) throw failed.error;

  return {
    people: profiles.data.map(p => ({ id: p.id, name: p.name, initials: p.initials, color: p.color })),
    teams: teams.data.map(t => ({
      id: t.id,
      name: t.name,
      ownerId: t.owner_id,
      memberIds: members.data.filter(m => m.team_id === t.id && m.status === 'active').map(m => m.user_id)
    })),
    teamMembers: members.data.map(m => ({ teamId: m.team_id, userId: m.user_id, role: m.role, status: m.status })),
    areas: areas.data.map(a => ({ id: a.id, name: a.name, icon: a.icon, color: a.color, category: a.category || 'Privat', ownerId: a.owner_id, teamId: a.team_id })),
    projects: projects.data.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      areaId: p.area_id,
      objective: p.objective,
      status: p.status || 'planned',
      health: p.health || 'on_track',
      ownerId: p.owner_id,
      startDate: p.start_date,
      dueDate: p.due_date
    })),
    tasks: tasks.data.map(camelTask),
    dependencies: dependencies.data.map(d => ({ taskId: d.task_id, dependsOnTaskId: d.depends_on_task_id })),
    comments: comments.data.map(c => ({ id: c.id, taskId: c.task_id, authorId: c.author_id, body: c.body, createdAt: c.created_at })),
    notifications: notifications.data.map(n => ({ id: n.id, userId: n.user_id, taskId: n.task_id, type: n.type, title: n.title, body: n.body, readAt: n.read_at, createdAt: n.created_at })),
    activity: activity.data.map(a => ({ id: a.id, taskId: a.task_id, actorId: a.actor_id, action: a.action, details: a.details, createdAt: a.created_at })),
    approvals: approvals.data.map(a => ({ id: a.id, taskId: a.task_id, requestedFrom: a.requested_from, requestedBy: a.requested_by, status: a.status, note: a.note })),
    taskLinks: taskLinks.data.map(camelLink),
    integrations: integrations.data.map(camelIntegration),
    calendarLinks: calendarLinks.data.map(camelCalendarLink),
    integrationEvents: integrationEvents.data.map(camelIntegrationEvent),
    dailyBriefs: dailyBriefs.data.map(b => ({
      id: b.id,
      userId: b.user_id,
      areaId: b.area_id,
      briefDate: b.brief_date,
      title: b.title,
      summary: b.summary,
      focusTaskIds: b.focus_task_ids || [],
      blockers: b.blockers || [],
      suggestions: b.suggestions || [],
      generatedBy: b.generated_by,
      createdAt: b.created_at
    })),
    agentRuns: agentRuns.data.map(r => ({
      id: r.id,
      userId: r.user_id,
      areaId: r.area_id,
      goal: r.goal,
      status: r.status,
      result: r.result || {},
      createdAt: r.created_at,
      completedAt: r.completed_at
    })),
    invitations: invitations.data.map(i => ({
      id: i.id,
      teamId: i.team_id,
      email: i.email,
      role: i.role,
      token: i.token,
      invitedBy: i.invited_by,
      expiresAt: i.expires_at,
      acceptedAt: i.accepted_at,
      createdAt: i.created_at || i.expires_at
    })),
    events: []
  };
}

export async function createCloudTask(input) {
  const user = (await session())?.user;
  if (!user) throw new Error('Du är inte inloggad.');

  const dependencies = input.dependencyTaskIds || [];
  const row = {
    title: input.title,
    notes: input.notes || '',
    project_id: input.projectId || null,
    created_by: user.id,
    assignee_id: input.assigneeId || user.id,
    parent_task_id: input.parentTaskId || null,
    bucket: input.bucket || 'inbox',
    priority: Number(input.priority || 3),
    due_text: input.due || '',
    due_at: nullableIso(input.dueAt),
    reminder_at: nullableIso(input.reminderAt),
    status: input.status || 'todo',
    task_type: input.taskType || 'task',
    recurrence_rule: input.recurrenceRule || null,
    activation_mode: input.activationMode || 'all',
    visible: !input.trigger && !dependencies.length,
    trigger_type: input.trigger?.type || null,
    trigger_task_id: input.trigger?.taskId || null,
    trigger_event: input.trigger?.event || null
  };

  const { data, error } = await supabase.from('tasks').insert(row).select().single();
  if (error) throw error;

  if (dependencies.length) {
    const { error: depError } = await supabase.from('task_dependencies').insert(dependencies.map(dependsOnTaskId => ({ task_id: data.id, depends_on_task_id: dependsOnTaskId })));
    if (depError) throw depError;
  }

  const links = cleanLinks(input.links);
  if (links.length) {
    const { error: linkError } = await supabase.from('task_links').insert(links.map(link => ({ ...link, task_id: data.id, created_by: user.id })));
    if (linkError) throw linkError;
  }

  if (input.taskType === 'approval') {
    const { error: approvalError } = await supabase.from('approvals').insert({ task_id: data.id, requested_from: input.assigneeId || user.id, requested_by: user.id });
    if (approvalError) throw approvalError;
  }

  return camelTask(data);
}

export async function updateCloudTask(id, patch) {
  const row = {};
  if ('completed' in patch) {
    row.completed = patch.completed;
    row.status = patch.completed ? 'done' : 'todo';
  }
  if ('title' in patch) row.title = patch.title;
  if ('notes' in patch) row.notes = patch.notes || '';
  if ('projectId' in patch) row.project_id = patch.projectId || null;
  if ('assigneeId' in patch) row.assignee_id = patch.assigneeId;
  if ('bucket' in patch) row.bucket = patch.bucket || 'inbox';
  if ('priority' in patch) row.priority = Number(patch.priority || 3);
  if ('due' in patch) row.due_text = patch.due || '';
  if ('dueAt' in patch) row.due_at = nullableIso(patch.dueAt);
  if ('reminderAt' in patch) row.reminder_at = nullableIso(patch.reminderAt);
  if ('status' in patch) row.status = patch.status;
  row.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from('tasks').update(row).eq('id', id).select().single();
  if (error) throw error;
  return camelTask(data);
}

export function subscribeToChanges(onChange) {
  return supabase.channel('orbit-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_links' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_briefs' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_runs' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'integration_accounts' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'integration_events' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_calendar_links' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'areas' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'invitations' }, onChange)
    .subscribe();
}

export async function addComment(taskId, body) {
  const user = (await session()).user;
  const { data, error } = await supabase.from('comments').insert({ task_id: taskId, author_id: user.id, body }).select().single();
  if (error) throw error;
  return data;
}

export async function addTaskLink(taskId, input) {
  const user = (await session()).user;
  const [link] = cleanLinks([{ ...input, title: input.title || input.url || 'Länk' }]);
  if (!link) throw new Error('Länken saknar innehåll.');
  const { data, error } = await supabase.from('task_links').insert({ ...link, task_id: taskId, created_by: user.id }).select().single();
  if (error) throw error;
  return camelLink(data);
}

export async function startGoogleCalendarOAuth() {
  const current = await session();
  if (!current?.access_token) throw new Error('Du är inte inloggad.');
  const response = await fetch('/api/google-auth-start', {
    headers: { authorization: `Bearer ${current.access_token}` }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Kunde inte starta Google OAuth.');
  return data.url;
}

export async function startSlackOAuth() {
  const current = await session();
  if (!current?.access_token) throw new Error('Du är inte inloggad.');
  const response = await fetch('/api/slack-auth-start', {
    headers: { authorization: `Bearer ${current.access_token}` }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Kunde inte starta Slack OAuth.');
  return data.url;
}

export function slackEventSummary(eventRow = {}) {
  const payload = eventRow.payload || {};
  const event = payload.event || {};
  const teamId = payload.team_id || payload.authorizations?.[0]?.team_id || '';
  const channelId = event.channel || event.item?.channel || event.message?.channel || payload.orbit?.slackChannelId || '';
  const messageTs = event.message?.ts || event.ts || event.item?.ts || event.event_ts || payload.orbit?.slackMessageTs || '';
  const threadTs = event.thread_ts || event.message?.thread_ts || payload.orbit?.slackThreadTs || messageTs || '';
  const authorExternalId = event.user || event.item_user || event.message?.user || '';
  const text = (event.text || event.message?.text || '').trim();
  const fallback = event.type === 'reaction_added'
    ? `Reaktion :${event.reaction || ''}: i Slack`
    : `Slack-event: ${event.type || eventRow.eventType || 'okänt'}`;
  const titleText = text || fallback;
  const title = titleText.length > 80 ? `${titleText.slice(0, 77)}…` : titleText;
  const url = event.permalink || payload.orbit?.slackPermalink || (teamId && channelId && messageTs ? `slack://channel?team=${encodeURIComponent(teamId)}&id=${encodeURIComponent(channelId)}&message=${encodeURIComponent(messageTs)}` : '');

  return {
    teamId,
    channelId,
    messageTs,
    threadTs,
    authorExternalId,
    text,
    title,
    url,
    eventType: event.type || eventRow.eventType || 'unknown'
  };
}

export async function createTaskFromSlackEvent(eventId, input = {}) {
  const user = (await session())?.user;
  if (!user) throw new Error('Du är inte inloggad.');

  const { data: rawEvent, error } = await supabase.from('integration_events').select('*').eq('id', eventId).single();
  if (error) throw error;
  const event = camelIntegrationEvent(rawEvent);
  const summary = slackEventSummary(event);
  const title = (input.title || summary.title || 'Slack-uppgift').trim();
  const projectId = input.projectId || null;
  const assigneeId = projectId ? (input.assigneeId || user.id) : user.id;
  const now = new Date().toISOString();
  const notes = [
    input.notes || '',
    summary.text && summary.text !== title ? summary.text : '',
    `Källa: Slack ${summary.eventType}${summary.channelId ? ` · kanal ${summary.channelId}` : ''}`,
    event.externalId ? `Slack event-id: ${event.externalId}` : ''
  ].filter(Boolean).join('\n\n');

  const task = await createCloudTask({
    title,
    notes,
    projectId,
    assigneeId,
    bucket: input.bucket || 'inbox',
    priority: Number(input.priority || 3),
    links: summary.url ? [{
      kind: 'chat',
      provider: 'Slack',
      title: 'Slack-meddelande',
      url: summary.url,
      externalId: summary.messageTs || event.externalId,
      metadata: {
        integrationEventId: event.id,
        channelId: summary.channelId,
        threadTs: summary.threadTs,
        teamId: summary.teamId
      }
    }] : []
  });

  if (event.integrationAccountId && summary.channelId && summary.messageTs) {
    const { error: linkError } = await supabase.from('slack_message_links').upsert({
      task_id: task.id,
      integration_account_id: event.integrationAccountId,
      channel_id: summary.channelId,
      message_ts: summary.messageTs,
      thread_ts: summary.threadTs || '',
      permalink: summary.url || '',
      author_external_id: summary.authorExternalId || '',
      text_snapshot: summary.text || '',
      metadata: { integrationEventId: event.id, teamId: summary.teamId }
    }, { onConflict: 'integration_account_id,channel_id,message_ts' });
    if (linkError) throw linkError;
  }

  const { error: updateError } = await supabase.from('integration_events').update({
    processed_at: now,
    payload: {
      ...rawEvent.payload,
      orbit: {
        taskId: task.id,
        processedBy: user.id,
        processedAt: now,
        action: 'created_task'
      }
    }
  }).eq('id', event.id);
  if (updateError) throw updateError;

  return task;
}

export async function syncCalendarLinkNow(calendarLinkId) {
  const current = await session();
  if (!current?.access_token) throw new Error('Du är inte inloggad.');
  const response = await fetch('/api/google-calendar-sync-now', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${current.access_token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ calendarLinkId })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Kunde inte synca Google Calendar.');
  return data.result;
}

export async function createCalendarIntegration(input = {}) {
  const user = (await session())?.user;
  if (!user) throw new Error('Du är inte inloggad.');
  const displayName = (input.displayName || 'Google Calendar').trim();
  const calendarId = (input.calendarId || 'primary').trim() || 'primary';

  const { data, error } = await supabase.from('integration_accounts').insert({
    provider: 'google_calendar',
    owner_id: user.id,
    display_name: displayName,
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
    token_ref: '',
    settings: {
      calendarId,
      setup: 'pending_oauth',
      note: 'Kopplingen är skapad i Orbit. Google OAuth/worker behöver aktiveras server-side innan automatisk sync körs.'
    },
    status: 'needs_auth'
  }).select().single();
  if (error) throw error;
  return camelIntegration(data);
}

export async function queueCalendarSync(taskId, input = {}) {
  const startAt = nullableIso(input.startAt);
  const endAt = nullableIso(input.endAt);
  if (!input.integrationAccountId) throw new Error('Välj en kalenderkoppling.');
  if (!startAt || !endAt) throw new Error('Kalendersync kräver start- och sluttid.');

  const { data, error } = await supabase.from('task_calendar_links').insert({
    task_id: taskId,
    integration_account_id: input.integrationAccountId,
    calendar_id: input.calendarId || 'primary',
    sync_direction: 'orbit_to_calendar',
    status: 'pending',
    start_at: startAt,
    end_at: endAt,
    time_zone: input.timeZone || 'Europe/Stockholm',
    payload: {
      title: input.title || '',
      description: input.description || '',
      source: 'orbit-web'
    }
  }).select().single();
  if (error) throw error;
  return camelCalendarLink(data);
}

export async function saveDailyBrief(input) {
  const user = (await session()).user;
  const { data, error } = await supabase.from('daily_briefs').insert({
    user_id: user.id,
    area_id: input.areaId || null,
    brief_date: input.briefDate,
    title: input.title || 'Dagens sammanfattning',
    summary: input.summary || '',
    focus_task_ids: input.focusTaskIds || [],
    blockers: input.blockers || [],
    suggestions: input.suggestions || [],
    generated_by: input.generatedBy || 'orbit-client-agent'
  }).select().single();
  if (error) throw error;
  return data;
}

export async function saveAgentRun(input) {
  const user = (await session())?.user;
  if (!user) throw new Error('Du är inte inloggad.');

  const { data, error } = await supabase.from('agent_runs').insert({
    user_id: user.id,
    area_id: input.areaId || null,
    goal: input.goal || 'Föreslå nästa steg',
    status: input.status || 'done',
    result: input.result || {},
    completed_at: input.completedAt || new Date().toISOString()
  }).select().single();
  if (error) throw error;
  return data;
}

export async function markNotificationRead(id) {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function updateProject(id, patch) {
  const row = {};
  for (const [k, v] of Object.entries(patch)) {
    const map = { ownerId: 'owner_id', startDate: 'start_date', dueDate: 'due_date' };
    row[map[k] || k] = v;
  }
  const { data, error } = await supabase.from('projects').update(row).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function decideApproval(id, status, note = '') {
  const { data, error } = await supabase.from('approvals').update({ status, note, decided_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw error;
  if (status === 'approved') await updateCloudTask(data.task_id, { completed: true });
  return data;
}

export async function createTeam(name) {
  const user = (await session())?.user;
  if (!user) throw new Error('Du är inte inloggad.');
  const cleanName = (name || '').trim();
  if (!cleanName) throw new Error('Teamet behöver ett namn.');

  const { data, error } = await supabase.from('teams').insert({ name: cleanName, owner_id: user.id }).select().single();
  if (error) throw error;

  const { error: memberError } = await supabase.from('team_members').insert({ team_id: data.id, user_id: user.id, role: 'owner', status: 'active' });
  if (memberError) throw memberError;

  return data;
}

export async function createInvitation(teamId, email, role = 'member') {
  const user = (await session())?.user;
  if (!user) throw new Error('Du är inte inloggad.');
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail) throw new Error('Inbjudan behöver en e-postadress.');
  const cleanRole = role === 'admin' ? 'admin' : 'member';
  const row = { team_id: teamId, email: cleanEmail, role: cleanRole, invited_by: user.id };

  const inserted = await supabase.from('invitations').insert(row).select().single();
  if (!inserted.error) return {
    id: inserted.data.id,
    teamId: inserted.data.team_id,
    email: inserted.data.email,
    role: inserted.data.role,
    acceptedAt: inserted.data.accepted_at,
    expiresAt: inserted.data.expires_at
  };

  if (inserted.error.code !== '23505') throw inserted.error;
  const { data, error } = await supabase.from('invitations')
    .update({ role: cleanRole, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() })
    .eq('team_id', teamId)
    .eq('email', cleanEmail)
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    teamId: data.team_id,
    email: data.email,
    role: data.role,
    acceptedAt: data.accepted_at,
    expiresAt: data.expires_at
  };
}

export async function shareAreaWithTeam(areaId, teamId) {
  return updateAreaDetails(areaId, { teamId });
}

export async function updateAreaDetails(areaId, patch = {}) {
  const row = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'teamId')) row.team_id = patch.teamId || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'category')) {
    const category = String(patch.category || '').trim() || 'Privat';
    row.category = category.slice(0, 80);
  }
  if (!Object.keys(row).length) throw new Error('Inget att uppdatera.');
  const { data, error } = await supabase.from('areas').update(row).eq('id', areaId).select().single();
  if (error) throw error;
  return data;
}
