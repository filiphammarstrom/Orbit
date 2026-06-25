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
  assigneeId: t.assignee_id,
  parentTaskId: t.parent_task_id,
  bucket: t.bucket,
  priority: t.priority,
  due: t.due_text || '',
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
    agentRuns
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
    supabase.from('agent_runs').select('*').order('created_at', { ascending: false }).limit(30)
  ]);

  const failed = [profiles, teams, members, areas, projects, tasks, dependencies, comments, notifications, activity, approvals, taskLinks, dailyBriefs, agentRuns].find(r => r.error);
  if (failed) throw failed.error;

  return {
    people: profiles.data.map(p => ({ id: p.id, name: p.name, initials: p.initials, color: p.color })),
    teams: teams.data.map(t => ({
      id: t.id,
      name: t.name,
      ownerId: t.owner_id,
      memberIds: members.data.filter(m => m.team_id === t.id && m.status === 'active').map(m => m.user_id)
    })),
    areas: areas.data.map(a => ({ id: a.id, name: a.name, icon: a.icon, color: a.color, ownerId: a.owner_id, teamId: a.team_id })),
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
  if ('assigneeId' in patch) row.assignee_id = patch.assigneeId;
  if ('status' in patch) row.status = patch.status;

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
