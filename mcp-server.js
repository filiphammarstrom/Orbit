import readline from 'node:readline';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const actorId = process.env.ORBIT_USER_ID;

if (!url || !serviceKey || !actorId) {
  console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY och ORBIT_USER_ID måste anges.');
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const taskInputSchema = {
  type: 'object',
  required: ['title'],
  properties: {
    tempId: { type: 'string' },
    title: { type: 'string' },
    notes: { type: 'string' },
    assigneeId: { type: 'string' },
    projectId: { type: 'string' },
    parentTaskId: { type: 'string' },
    parentTempId: { type: 'string' },
    bucket: { type: 'string' },
    priority: { type: 'number' },
    due: { type: 'string' },
    dueAt: { type: 'string' },
    reminderAt: { type: 'string' },
    recurrenceRule: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
    status: { type: 'string' },
    taskType: { type: 'string' },
    activationMode: { type: 'string' },
    dependencyTaskIds: { type: 'array', items: { type: 'string' } },
    dependsOnTempIds: { type: 'array', items: { type: 'string' } },
    trigger: { type: 'object' },
    links: { type: 'array', items: { type: 'object' } },
    sourceUrl: { type: 'string' },
    sourceTitle: { type: 'string' },
    sourceKind: { type: 'string' },
    sourceProvider: { type: 'string' }
  }
};

const tools = [
  {
    name: 'list_workspace',
    description: 'Returnerar de områden, projekt, team och personer som den externa AI:n får arbeta med. Använd detta först innan tasks skapas eller tilldelas.',
    inputSchema: { type: 'object', properties: { includePeople: { type: 'boolean' }, includeProjects: { type: 'boolean' }, includeTeams: { type: 'boolean' } } }
  },
  {
    name: 'list_tasks',
    description: 'Lista uppgifter som MCP-användaren får se. Stödjer synliga/dolda, klara/öppna, filtrering och app-länkar.',
    inputSchema: {
      type: 'object',
      properties: {
        assigneeId: { type: 'string' },
        projectId: { type: 'string' },
        areaId: { type: 'string' },
        bucket: { type: 'string' },
        status: { type: 'string' },
        includeLinks: { type: 'boolean' },
        includeHidden: { type: 'boolean' },
        includeCompleted: { type: 'boolean' }
      }
    }
  },
  {
    name: 'create_area',
    description: 'Skapa ett område under en kategori. Kategorier syns i Orbit när de har minst ett område.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        category: { type: 'string' },
        icon: { type: 'string' },
        color: { type: 'string' },
        teamId: { type: 'string' }
      }
    }
  },
  {
    name: 'update_area',
    description: 'Uppdatera område: namn, kategori, ikon, färg eller vilket team som delar området.',
    inputSchema: {
      type: 'object',
      required: ['areaId'],
      properties: {
        areaId: { type: 'string' },
        name: { type: 'string' },
        category: { type: 'string' },
        icon: { type: 'string' },
        color: { type: 'string' },
        teamId: { type: 'string' }
      }
    }
  },
  {
    name: 'create_project',
    description: 'Skapa ett projekt i ett område som MCP-användaren har åtkomst till.',
    inputSchema: {
      type: 'object',
      required: ['areaId', 'name'],
      properties: {
        areaId: { type: 'string' },
        name: { type: 'string' },
        icon: { type: 'string' },
        color: { type: 'string' },
        objective: { type: 'string' },
        ownerId: { type: 'string' },
        status: { type: 'string' },
        health: { type: 'string' },
        startDate: { type: 'string' },
        dueDate: { type: 'string' }
      }
    }
  },
  {
    name: 'update_project',
    description: 'Uppdatera projektstatus, mål, hälsa, ägare eller datum.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string' },
        name: { type: 'string' },
        icon: { type: 'string' },
        color: { type: 'string' },
        objective: { type: 'string' },
        ownerId: { type: 'string' },
        status: { type: 'string' },
        health: { type: 'string' },
        startDate: { type: 'string' },
        dueDate: { type: 'string' }
      }
    }
  },
  {
    name: 'create_task',
    description: 'Skapa en uppgift, underuppgift eller villkorsstyrd uppgift i ett tillåtet område. Stödjer tilldelning, app-länkar och beroenden.',
    inputSchema: taskInputSchema
  },
  {
    name: 'bulk_create_tasks',
    description: 'Skapa många tasks i ett svep. Stödjer tempId, parentTempId och dependsOnTempIds så en AI kan bygga projektplaner och kedjor.',
    inputSchema: {
      type: 'object',
      required: ['tasks'],
      properties: {
        dryRun: { type: 'boolean' },
        defaultProjectId: { type: 'string' },
        defaultAssigneeId: { type: 'string' },
        tasks: { type: 'array', items: taskInputSchema }
      }
    }
  },
  {
    name: 'update_task',
    description: 'Uppdatera en befintlig uppgift: titel, anteckning, status, bucket, prioritet, datum, projekt eller tilldelad person.',
    inputSchema: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string' },
        notes: { type: 'string' },
        assigneeId: { type: 'string' },
        projectId: { type: 'string' },
        parentTaskId: { type: 'string' },
        bucket: { type: 'string' },
        priority: { type: 'number' },
        due: { type: 'string' },
        dueAt: { type: 'string' },
        reminderAt: { type: 'string' },
        recurrenceRule: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
        status: { type: 'string' },
        completed: { type: 'boolean' },
        visible: { type: 'boolean' }
      }
    }
  },
  {
    name: 'assign_task',
    description: 'Tilldela en task till en annan person som har åtkomst till uppgiftens område.',
    inputSchema: { type: 'object', required: ['taskId', 'assigneeId'], properties: { taskId: { type: 'string' }, assigneeId: { type: 'string' } } }
  },
  {
    name: 'add_comment',
    description: 'Lägg till en kommentar på en task, t.ex. “Skapad av Claude från mötesanteckningarna”.',
    inputSchema: { type: 'object', required: ['taskId', 'body'], properties: { taskId: { type: 'string' }, body: { type: 'string' } } }
  },
  {
    name: 'add_task_link',
    description: 'Lägg till en länk från en annan app på en befintlig uppgift, t.ex. Gmail, Outlook, Slack, Calendar eller Google Docs.',
    inputSchema: {
      type: 'object',
      required: ['taskId', 'url'],
      properties: {
        taskId: { type: 'string' },
        url: { type: 'string' },
        title: { type: 'string' },
        kind: { type: 'string' },
        provider: { type: 'string' },
        externalId: { type: 'string' },
        metadata: { type: 'object' }
      }
    }
  },
  {
    name: 'list_integrations',
    description: 'Lista Google Calendar- och Slack-kopplingar som AI:n får använda.',
    inputSchema: { type: 'object', properties: { provider: { type: 'string' }, areaId: { type: 'string' }, includePaused: { type: 'boolean' } } }
  },
  {
    name: 'register_integration',
    description: 'Registrera en integration efter OAuth/setup. Lagrar inte token i klartext; tokenRef ska peka på en secret/vault-post.',
    inputSchema: {
      type: 'object',
      required: ['provider', 'displayName'],
      properties: {
        provider: { type: 'string' },
        displayName: { type: 'string' },
        areaId: { type: 'string' },
        teamId: { type: 'string' },
        providerUserId: { type: 'string' },
        providerTeamId: { type: 'string' },
        scopes: { type: 'array', items: { type: 'string' } },
        tokenRef: { type: 'string' },
        settings: { type: 'object' },
        status: { type: 'string' }
      }
    }
  },
  {
    name: 'schedule_task_on_calendar',
    description: 'Köar eller registrerar kalender-sync för en task. En separat worker/OAuth-koppling skapar eventet i Google Calendar.',
    inputSchema: {
      type: 'object',
      required: ['taskId', 'integrationAccountId', 'startAt', 'endAt'],
      properties: {
        taskId: { type: 'string' },
        integrationAccountId: { type: 'string' },
        calendarId: { type: 'string' },
        startAt: { type: 'string' },
        endAt: { type: 'string' },
        timeZone: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        location: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string' } },
        eventUrl: { type: 'string' },
        providerEventId: { type: 'string' },
        syncDirection: { type: 'string' }
      }
    }
  },
  {
    name: 'link_calendar_event',
    description: 'Länka en befintlig Google Calendar-händelse till en task.',
    inputSchema: {
      type: 'object',
      required: ['taskId', 'integrationAccountId', 'providerEventId'],
      properties: {
        taskId: { type: 'string' },
        integrationAccountId: { type: 'string' },
        calendarId: { type: 'string' },
        providerEventId: { type: 'string' },
        eventUrl: { type: 'string' },
        startAt: { type: 'string' },
        endAt: { type: 'string' },
        timeZone: { type: 'string' },
        payload: { type: 'object' }
      }
    }
  },
  {
    name: 'link_slack_message',
    description: 'Länka ett Slack-meddelande eller en Slack-tråd till en task.',
    inputSchema: {
      type: 'object',
      required: ['taskId', 'integrationAccountId', 'channelId', 'messageTs'],
      properties: {
        taskId: { type: 'string' },
        integrationAccountId: { type: 'string' },
        channelId: { type: 'string' },
        messageTs: { type: 'string' },
        threadTs: { type: 'string' },
        permalink: { type: 'string' },
        authorExternalId: { type: 'string' },
        text: { type: 'string' },
        metadata: { type: 'object' }
      }
    }
  },
  {
    name: 'create_task_from_slack',
    description: 'Skapa en Orbit-task från ett Slack-meddelande och länka tillbaka till Slack.',
    inputSchema: {
      type: 'object',
      required: ['integrationAccountId', 'channelId', 'messageTs', 'title'],
      properties: {
        integrationAccountId: { type: 'string' },
        channelId: { type: 'string' },
        messageTs: { type: 'string' },
        threadTs: { type: 'string' },
        permalink: { type: 'string' },
        authorExternalId: { type: 'string' },
        text: { type: 'string' },
        metadata: { type: 'object' },
        title: { type: 'string' },
        notes: { type: 'string' },
        assigneeId: { type: 'string' },
        projectId: { type: 'string' },
        bucket: { type: 'string' },
        priority: { type: 'number' },
        due: { type: 'string' },
        dueAt: { type: 'string' },
        reminderAt: { type: 'string' }
      }
    }
  },
  {
    name: 'ingest_integration_event',
    description: 'Spara en inkommande Slack/Google Calendar-händelse och kan samtidigt trigga dolda tasks via emit_event-flödet.',
    inputSchema: {
      type: 'object',
      required: ['provider', 'eventType'],
      properties: {
        provider: { type: 'string' },
        integrationAccountId: { type: 'string' },
        areaId: { type: 'string' },
        eventType: { type: 'string' },
        externalId: { type: 'string' },
        triggerName: { type: 'string' },
        payload: { type: 'object' }
      }
    }
  },
  {
    name: 'complete_task',
    description: 'Slutför en åtkomlig uppgift. Databasen aktiverar beroenden och beräknar föräldrauppgiften.',
    inputSchema: { type: 'object', required: ['taskId'], properties: { taskId: { type: 'string' } } }
  },
  {
    name: 'emit_event',
    description: 'Rapportera en extern händelse i ett område. Används t.ex. när ett mail har besvarats eller ett externt system har skickat signal.',
    inputSchema: { type: 'object', required: ['areaId', 'name'], properties: { areaId: { type: 'string' }, name: { type: 'string' }, payload: { type: 'object' } } }
  },
  {
    name: 'daily_brief',
    description: 'Skapa en daglig MCP/AI-sammanfattning av synliga uppgifter, prioritet, väntelägen och uppgifter med app-länkar.',
    inputSchema: { type: 'object', properties: { date: { type: 'string' }, areaId: { type: 'string' }, save: { type: 'boolean' } } }
  },
  {
    name: 'agent_suggest_next_actions',
    description: 'Låt Orbit-agenten föreslå nästa drag baserat på prioritet, inbox, väntande uppgifter, länkar och dagens plan.',
    inputSchema: { type: 'object', properties: { areaId: { type: 'string' }, goal: { type: 'string' }, save: { type: 'boolean' } } }
  }
];

function todayISO() {
  return stockholmDateISO(new Date());
}

function stockholmDateISO(value) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function nullableIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function accessFilter(ctx) {
  const parts = [`created_by.eq.${actorId}`, `assignee_id.eq.${actorId}`];
  if (ctx.projectIds.length) parts.push(`project_id.in.(${ctx.projectIds.join(',')})`);
  return parts.join(',');
}

function normalizeLinks(args = {}) {
  const explicit = Array.isArray(args.links) ? args.links : [];
  const source = args.sourceUrl ? [{
    url: args.sourceUrl,
    title: args.sourceTitle || args.title || 'Källa',
    kind: args.sourceKind || 'other',
    provider: args.sourceProvider || ''
  }] : [];

  return [...explicit, ...source]
    .map(link => ({
      kind: link.kind || 'other',
      provider: link.provider || '',
      title: link.title || link.url || 'Länk',
      url: link.url || '',
      external_id: link.externalId || link.external_id || '',
      metadata: link.metadata || {}
    }))
    .filter(link => link.url || link.external_id || link.title);
}

function uniqTasks(tasks) {
  return [...new Map(tasks.filter(Boolean).map(task => [task.id, task])).values()];
}

function compactRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function cleanText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function orderTasksForParents(tasks) {
  const pending = [...tasks];
  const createdTempIds = new Set();
  const ordered = [];
  while (pending.length) {
    const index = pending.findIndex(task => !task.parentTempId || createdTempIds.has(task.parentTempId));
    if (index === -1) throw new Error('Kunde inte ordna parentTempId-kedjan. Kontrollera att underuppgifter inte pekar i cirkel.');
    const [task] = pending.splice(index, 1);
    ordered.push(task);
    if (task.tempId) createdTempIds.add(task.tempId);
  }
  return ordered;
}

async function access() {
  const { data: memberships, error: mErr } = await db.from('team_members').select('team_id,user_id,role,status').eq('user_id', actorId).eq('status', 'active');
  if (mErr) throw mErr;

  const teamIds = memberships.map(m => m.team_id);
  const areaFilter = teamIds.length ? `owner_id.eq.${actorId},team_id.in.(${teamIds.join(',')})` : `owner_id.eq.${actorId}`;
  const { data: areas, error: aErr } = await db.from('areas').select('*').or(areaFilter).order('created_at');
  if (aErr) throw aErr;

  const areaIds = areas.map(a => a.id);
  const { data: projects, error: pErr } = areaIds.length
    ? await db.from('projects').select('*').in('area_id', areaIds).is('archived_at', null).order('created_at')
    : { data: [], error: null };
  if (pErr) throw pErr;

  const accessibleTeamIds = [...new Set([...teamIds, ...areas.map(a => a.team_id).filter(Boolean)])];
  const { data: teams, error: tErr } = accessibleTeamIds.length
    ? await db.from('teams').select('*').in('id', accessibleTeamIds)
    : { data: [], error: null };
  if (tErr) throw tErr;

  const { data: allMembers, error: amErr } = accessibleTeamIds.length
    ? await db.from('team_members').select('team_id,user_id,role,status').in('team_id', accessibleTeamIds)
    : { data: [], error: null };
  if (amErr) throw amErr;

  const { data: categorySettings, error: cErr } = await db.from('category_settings').select('*').eq('owner_id', actorId).order('name');
  if (cErr) throw cErr;

  const userIds = [...new Set([
    actorId,
    ...areas.map(a => a.owner_id).filter(Boolean),
    ...projects.map(p => p.owner_id).filter(Boolean),
    ...teams.map(t => t.owner_id).filter(Boolean),
    ...allMembers.filter(m => m.status === 'active').map(m => m.user_id)
  ])];

  const { data: profiles, error: prErr } = userIds.length
    ? await db.from('profiles').select('*').in('id', userIds)
    : { data: [], error: null };
  if (prErr) throw prErr;

  return {
    areaIds,
    projectIds: projects.map(p => p.id),
    teamIds: accessibleTeamIds,
    areas,
    projects,
    teams,
    categorySettings,
    members: allMembers,
    profiles
  };
}

function areaForProject(ctx, projectId) {
  const project = ctx.projects.find(p => p.id === projectId);
  return project ? ctx.areas.find(a => a.id === project.area_id) : null;
}

function canUserAccessArea(ctx, userId, areaId) {
  const area = ctx.areas.find(a => a.id === areaId);
  if (!area) return false;
  if (area.owner_id === userId) return true;
  return Boolean(area.team_id && ctx.members.some(m => m.team_id === area.team_id && m.user_id === userId && m.status === 'active'));
}

function ensureProjectAccess(ctx, projectId) {
  if (projectId && !ctx.projectIds.includes(projectId)) throw new Error('Ingen åtkomst till projektet.');
}

function ensureAreaAccess(ctx, areaId) {
  if (!ctx.areaIds.includes(areaId)) throw new Error('Ingen åtkomst till området.');
}

function sharesTeamWithActor(ctx, userId) {
  if (!userId || userId === actorId) return Boolean(userId);
  const actorTeams = new Set(ctx.members.filter(m => m.user_id === actorId && m.status === 'active').map(m => m.team_id));
  return ctx.members.some(m => m.user_id === userId && m.status === 'active' && actorTeams.has(m.team_id));
}

function ensureAssignable(ctx, assigneeId, projectId) {
  if (!assigneeId) return;
  if (!projectId) {
    if (!sharesTeamWithActor(ctx, assigneeId)) throw new Error('Uppgifter utan projekt kan bara tilldelas dig själv eller en aktiv teammedlem.');
    return;
  }
  const area = areaForProject(ctx, projectId);
  if (!area || !canUserAccessArea(ctx, assigneeId, area.id)) throw new Error('Den tilldelade personen har inte åtkomst till uppgiftens område.');
}

function canAccessIntegration(ctx, integration) {
  if (!integration) return false;
  return integration.owner_id === actorId
    || (integration.area_id && ctx.areaIds.includes(integration.area_id))
    || (integration.team_id && ctx.teamIds.includes(integration.team_id));
}

async function listIntegrations(ctx, args = {}) {
  let q = db.from('integration_accounts').select('*');
  if (args.provider) q = q.eq('provider', args.provider);
  if (args.areaId) {
    ensureAreaAccess(ctx, args.areaId);
    q = q.eq('area_id', args.areaId);
  }
  if (!args.includePaused) q = q.eq('status', 'active');
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return data.filter(integration => canAccessIntegration(ctx, integration));
}

async function allowedIntegration(id, ctx, provider) {
  const { data, error } = await db.from('integration_accounts').select('*').eq('id', id).single();
  if (error) throw error;
  if (!canAccessIntegration(ctx, data)) throw new Error('Ingen åtkomst till integrationen.');
  if (provider && data.provider !== provider) throw new Error(`Integrationen måste vara ${provider}.`);
  if (data.status !== 'active') throw new Error('Integrationen är inte aktiv.');
  return data;
}

async function allowedTask(id, ctx) {
  const { data, error } = await db.from('tasks').select('*').eq('id', id).single();
  if (error) throw error;
  if (data.created_by !== actorId && data.assignee_id !== actorId && !ctx.projectIds.includes(data.project_id)) throw new Error('Ingen åtkomst till uppgiften.');
  return data;
}

async function taskLinks(taskIds) {
  if (!taskIds.length) return new Map();
  const { data, error } = await db.from('task_links').select('*').in('task_id', taskIds).order('created_at', { ascending: false });
  if (error) throw error;
  const grouped = new Map();
  for (const link of data) grouped.set(link.task_id, [...(grouped.get(link.task_id) || []), link]);
  return grouped;
}

function withLinks(tasks, linksByTask) {
  return tasks.map(task => ({ ...task, links: linksByTask.get(task.id) || [] }));
}

async function listTasks(ctx, args = {}) {
  if (args.projectId) ensureProjectAccess(ctx, args.projectId);
  if (args.areaId) ensureAreaAccess(ctx, args.areaId);

  let q = db.from('tasks').select('*').or(accessFilter(ctx));
  if (!args.includeHidden) q = q.eq('visible', true);
  if (!args.includeCompleted) q = q.eq('completed', false);
  if (args.assigneeId) q = q.eq('assignee_id', args.assigneeId);
  if (args.projectId) q = q.eq('project_id', args.projectId);
  if (args.bucket) q = q.eq('bucket', args.bucket);
  if (args.status) q = q.eq('status', args.status);
  if (args.areaId) {
    const projectIds = ctx.projects.filter(p => p.area_id === args.areaId).map(p => p.id);
    if (!projectIds.length) return [];
    q = q.in('project_id', projectIds);
  }

  const { data, error } = await q.order('created_at');
  if (error) throw error;
  return data;
}

function buildBrief(tasks, linksByTask, date = todayISO()) {
  const active = tasks.filter(t => t.visible && !t.completed);
  const today = active.filter(t => t.bucket === 'today' || (t.due_at && stockholmDateISO(t.due_at) === date));
  const overdue = active.filter(t => t.due_at && stockholmDateISO(t.due_at) < date);
  const p1 = active.filter(t => Number(t.priority) === 1);
  const doing = active.filter(t => t.status === 'doing');
  const waiting = active.filter(t => t.status === 'waiting');
  const inbox = active.filter(t => t.bucket === 'inbox');
  const linked = active.filter(t => (linksByTask.get(t.id) || []).length);
  const focus = uniqTasks([...p1, ...doing, ...today]).slice(0, 5);

  const suggestions = [];
  if (overdue.length) suggestions.push({ type: 'overdue', text: `${overdue.length} uppgift${overdue.length > 1 ? 'er är' : ' är'} försenad${overdue.length > 1 ? 'e' : ''}.` });
  if (p1.length) suggestions.push({ type: 'priority', text: `Börja med ${p1.length} P1-uppgift${p1.length > 1 ? 'er' : ''}.` });
  if (inbox.length >= 3) suggestions.push({ type: 'inbox', text: `Rensa inboxen: ${inbox.length} okategoriserade uppgifter väntar.` });
  if (waiting.length) suggestions.push({ type: 'waiting', text: `${waiting.length} uppgift${waiting.length > 1 ? 'er' : ''} står i vänteläge. Be agenten följa upp blockeringen.` });
  if (linked.length) suggestions.push({ type: 'context', text: `${linked.length} uppgift${linked.length > 1 ? 'er har' : ' har'} länkar till mail, dokument eller andra appar.` });
  if (!suggestions.length) suggestions.push({ type: 'calm', text: 'Läget är rent. Välj en tydlig nästa uppgift och håll flödet enkelt.' });

  return {
    title: `Dagens Orbit-brief · ${date}`,
    summary: `Du har ${today.length} uppgift${today.length === 1 ? '' : 'er'} i dagens vy, ${p1.length} P1${overdue.length ? `, ${overdue.length} försenad${overdue.length > 1 ? 'e' : ''}` : ''} och ${waiting.length} väntande. ${focus.length ? `Föreslaget fokus: ${focus.map(t => t.title).join(', ')}.` : 'Ingen akut fokusuppgift hittades.'}`,
    focusTaskIds: focus.map(t => t.id),
    focusTasks: focus.map(t => ({ id: t.id, title: t.title, priority: t.priority, bucket: t.bucket, due: t.due_text, dueAt: t.due_at, reminderAt: t.reminder_at, links: linksByTask.get(t.id) || [] })),
    blockers: waiting.slice(0, 5).map(t => ({ taskId: t.id, title: t.title, reason: t.activation_reason || t.trigger_event || 'Markerad som väntar' })),
    suggestions,
    counts: { active: active.length, today: today.length, overdue: overdue.length, priority1: p1.length, waiting: waiting.length, inbox: inbox.length, linked: linked.length }
  };
}

async function addLinks(taskId, args) {
  const links = normalizeLinks(args);
  if (!links.length) return [];
  const { data, error } = await db.from('task_links').insert(links.map(link => ({ ...link, task_id: taskId, created_by: actorId }))).select();
  if (error) throw error;
  return data;
}

async function addSingleTaskLink(taskId, link) {
  const [normalized] = normalizeLinks({ links: [link] });
  if (!normalized) return null;
  const { data, error } = await db.from('task_links').insert({ ...normalized, task_id: taskId, created_by: actorId }).select().single();
  if (error) throw error;
  return data;
}

async function createCalendarLink(ctx, input, status = 'pending') {
  const task = await allowedTask(input.taskId, ctx);
  await allowedIntegration(input.integrationAccountId, ctx, 'google_calendar');
  const payload = {
    title: input.title || task.title,
    description: input.description || task.notes || '',
    location: input.location || '',
    attendees: input.attendees || [],
    source: 'orbit-mcp'
  };
  const row = {
    task_id: task.id,
    integration_account_id: input.integrationAccountId,
    calendar_id: input.calendarId || 'primary',
    provider_event_id: input.providerEventId || '',
    event_url: input.eventUrl || '',
    sync_direction: input.syncDirection || 'orbit_to_calendar',
    status,
    start_at: input.startAt || null,
    end_at: input.endAt || null,
    time_zone: input.timeZone || 'Europe/Stockholm',
    payload: { ...payload, ...(input.payload || {}) },
    last_synced_at: status === 'synced' ? new Date().toISOString() : null
  };
  const { data, error } = await db.from('task_calendar_links').insert(row).select().single();
  if (error) throw error;
  if (input.eventUrl) await addSingleTaskLink(task.id, { kind: 'calendar', provider: 'Google Calendar', title: payload.title, url: input.eventUrl, externalId: input.providerEventId || '', metadata: { calendarLinkId: data.id } });
  return data;
}

async function createSlackLink(ctx, input) {
  await allowedIntegration(input.integrationAccountId, ctx, 'slack');
  if (input.taskId) await allowedTask(input.taskId, ctx);
  const row = {
    task_id: input.taskId || null,
    integration_account_id: input.integrationAccountId,
    channel_id: input.channelId,
    message_ts: input.messageTs,
    thread_ts: input.threadTs || '',
    permalink: input.permalink || '',
    author_external_id: input.authorExternalId || '',
    text_snapshot: input.text || '',
    metadata: input.metadata || {}
  };
  const { data, error } = await db.from('slack_message_links').insert(row).select().single();
  if (error) throw error;
  if (input.taskId && input.permalink) await addSingleTaskLink(input.taskId, { kind: 'chat', provider: 'Slack', title: 'Slack-meddelande', url: input.permalink, externalId: input.messageTs, metadata: { slackLinkId: data.id, channelId: input.channelId } });
  return data;
}

async function addDependencies(taskId, dependencyTaskIds) {
  const ids = [...new Set((dependencyTaskIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await db.from('task_dependencies').insert(ids.map(dependsOnTaskId => ({ task_id: taskId, depends_on_task_id: dependsOnTaskId }))).select();
  if (error) throw error;
  return data;
}

async function upsertCategorySetting(name, icon, color) {
  const cleanName = cleanText(name, 'Privat') || 'Privat';
  const { error } = await db.from('category_settings').upsert({
    owner_id: actorId,
    name: cleanName.slice(0, 80),
    icon: String(icon || '▣').trim().slice(0, 2) || '▣',
    color: color || '#7659ef',
    updated_at: new Date().toISOString()
  }, { onConflict: 'owner_id,name' });
  if (error) throw error;
}

async function createTask(ctx, input = {}, tempMap = new Map(), defaults = {}) {
  const title = cleanText(input.title);
  if (!title) throw new Error('Uppgiften saknar titel.');

  const parentTaskId = input.parentTaskId || (input.parentTempId ? tempMap.get(input.parentTempId) : null) || null;
  const parent = parentTaskId ? await allowedTask(parentTaskId, ctx) : null;
  const projectId = input.projectId || defaults.defaultProjectId || parent?.project_id || null;
  const assigneeId = input.assigneeId || defaults.defaultAssigneeId || actorId;
  const hasDeferredDependencies = Boolean(input.hasDeferredDependencies || (Array.isArray(input.dependsOnTempIds) && input.dependsOnTempIds.length));
  const dependencyTaskIds = [
    ...(Array.isArray(input.dependencyTaskIds) ? input.dependencyTaskIds : []),
    ...(Array.isArray(input.dependsOnTempIds) ? input.dependsOnTempIds.map(id => tempMap.get(id)).filter(Boolean) : [])
  ];
  let trigger = input.trigger?.type ? { ...input.trigger } : null;
  if (trigger?.type === 'task_completed' && !trigger.taskId) {
    if (dependencyTaskIds.length || hasDeferredDependencies) trigger = null;
    else throw new Error('Triggern task_completed kräver trigger.taskId eller ett beroende.');
  }
  if (trigger?.type === 'external_event' && !trigger.event) throw new Error('Triggern external_event kräver trigger.event.');

  ensureProjectAccess(ctx, projectId);
  ensureAssignable(ctx, assigneeId, projectId);
  for (const id of dependencyTaskIds) await allowedTask(id, ctx);
  if (trigger?.taskId) await allowedTask(trigger.taskId, ctx);

  const row = {
    title,
    notes: input.notes || '',
    created_by: actorId,
    assignee_id: assigneeId,
    project_id: projectId,
    parent_task_id: parentTaskId,
    bucket: input.bucket || 'inbox',
    priority: Number(input.priority || 3),
    due_text: input.due || '',
    due_at: nullableIso(input.dueAt),
    reminder_at: nullableIso(input.reminderAt),
    recurrence_rule: input.recurrenceRule || null,
    status: input.status || 'todo',
    task_type: input.taskType || 'task',
    activation_mode: input.activationMode || 'all',
    visible: !trigger && !dependencyTaskIds.length && !hasDeferredDependencies,
    trigger_type: trigger?.type || null,
    trigger_task_id: trigger?.taskId || null,
    trigger_event: trigger?.event || null
  };

  const { data, error } = await db.from('tasks').insert(row).select().single();
  if (error) throw error;

  await addDependencies(data.id, dependencyTaskIds);
  await addLinks(data.id, input);

  if (input.taskType === 'approval') {
    const { error: approvalError } = await db.from('approvals').insert({ task_id: data.id, requested_from: assigneeId, requested_by: actorId });
    if (approvalError) throw approvalError;
  }

  return data;
}

async function updateTask(ctx, input) {
  const current = await allowedTask(input.taskId, ctx);
  const projectId = input.projectId !== undefined ? input.projectId || null : current.project_id;
  const assigneeId = input.assigneeId !== undefined ? input.assigneeId || actorId : current.assignee_id;
  const parentTaskId = input.parentTaskId !== undefined ? input.parentTaskId || null : undefined;

  ensureProjectAccess(ctx, projectId);
  ensureAssignable(ctx, assigneeId, projectId);
  if (parentTaskId) await allowedTask(parentTaskId, ctx);

  const row = compactRow({
    title: input.title,
    notes: input.notes,
    assignee_id: input.assigneeId !== undefined ? assigneeId : undefined,
    project_id: input.projectId !== undefined ? projectId : undefined,
    parent_task_id: parentTaskId,
    bucket: input.bucket,
    priority: input.priority !== undefined ? Number(input.priority) : undefined,
    due_text: input.due,
    due_at: input.dueAt !== undefined ? nullableIso(input.dueAt) : undefined,
    reminder_at: input.reminderAt !== undefined ? nullableIso(input.reminderAt) : undefined,
    recurrence_rule: input.recurrenceRule !== undefined ? input.recurrenceRule || null : undefined,
    status: input.completed ? 'done' : input.status,
    completed: input.completed,
    visible: input.visible
  });

  if (!Object.keys(row).length) return current;
  const { data, error } = await db.from('tasks').update(row).eq('id', input.taskId).select().single();
  if (error) throw error;
  return data;
}

async function call(name, a = {}) {
  const ctx = await access();

  if (name === 'list_workspace') {
    return {
      actorId,
      areas: ctx.areas,
      categories: ctx.categorySettings,
      projects: a.includeProjects === false ? undefined : ctx.projects,
      teams: a.includeTeams === false ? undefined : ctx.teams.map(t => ({ ...t, memberIds: ctx.members.filter(m => m.team_id === t.id && m.status === 'active').map(m => m.user_id) })),
      people: a.includePeople === false ? undefined : ctx.profiles,
      integrations: await listIntegrations(ctx, {}),
      assignmentRule: 'AI får tilldela en uppgift till en person om personen har åtkomst till uppgiftens område. Uppgifter utan projekt kan tilldelas ORBIT_USER_ID eller en aktiv teammedlem.'
    };
  }

  if (name === 'list_tasks') {
    const tasks = await listTasks(ctx, a);
    if (!a.includeLinks) return tasks;
    const links = await taskLinks(tasks.map(t => t.id));
    return withLinks(tasks, links);
  }

  if (name === 'create_area') {
    const areaName = cleanText(a.name);
    if (!areaName) throw new Error('Området behöver ett namn.');
    if (a.teamId && !ctx.teamIds.includes(a.teamId)) throw new Error('Ingen åtkomst till teamet.');
    const category = cleanText(a.category, 'Privat') || 'Privat';
    await upsertCategorySetting(category, a.icon, a.color);
    const { data, error } = await db.from('areas').insert({
      name: areaName.slice(0, 120),
      category: category.slice(0, 80),
      icon: String(a.icon || '◫').trim().slice(0, 2) || '◫',
      color: a.color || '#7659ef',
      owner_id: actorId,
      team_id: a.teamId || null
    }).select().single();
    if (error) throw error;
    return data;
  }

  if (name === 'update_area') {
    ensureAreaAccess(ctx, a.areaId);
    const current = ctx.areas.find(area => area.id === a.areaId);
    if (current.owner_id !== actorId) throw new Error('Bara områdets ägare kan ändra område via MCP.');
    if (a.teamId && !ctx.teamIds.includes(a.teamId)) throw new Error('Ingen åtkomst till teamet.');
    const category = a.category !== undefined ? cleanText(a.category, 'Privat') || 'Privat' : undefined;
    if (category) await upsertCategorySetting(category, a.icon || current.icon, a.color || current.color);
    const row = compactRow({
      name: a.name ? cleanText(a.name).slice(0, 120) : undefined,
      category: category ? category.slice(0, 80) : undefined,
      icon: a.icon ? String(a.icon).trim().slice(0, 2) || '◫' : undefined,
      color: a.color,
      team_id: a.teamId !== undefined ? a.teamId || null : undefined
    });
    if (!Object.keys(row).length) return current;
    const { data, error } = await db.from('areas').update(row).eq('id', a.areaId).select().single();
    if (error) throw error;
    return data;
  }

  if (name === 'create_project') {
    ensureAreaAccess(ctx, a.areaId);
    const ownerId = a.ownerId || actorId;
    if (!canUserAccessArea(ctx, ownerId, a.areaId)) throw new Error('Projektägaren har inte åtkomst till området.');
    const { data, error } = await db.from('projects').insert({
      area_id: a.areaId,
      name: a.name,
      icon: String(a.icon || '▣').trim().slice(0, 2) || '▣',
      color: a.color || '#8b70ff',
      objective: a.objective || '',
      owner_id: ownerId,
      status: a.status || 'planned',
      health: a.health || 'on_track',
      start_date: a.startDate || null,
      due_date: a.dueDate || null
    }).select().single();
    if (error) throw error;
    return data;
  }

  if (name === 'update_project') {
    ensureProjectAccess(ctx, a.projectId);
    const project = ctx.projects.find(p => p.id === a.projectId);
    const ownerId = a.ownerId || project.owner_id;
    if (a.ownerId && !canUserAccessArea(ctx, ownerId, project.area_id)) throw new Error('Projektägaren har inte åtkomst till området.');
    const row = compactRow({
      name: a.name,
      icon: a.icon ? String(a.icon).trim().slice(0, 2) || '▣' : undefined,
      color: a.color,
      objective: a.objective,
      owner_id: a.ownerId,
      status: a.status,
      health: a.health,
      start_date: a.startDate,
      due_date: a.dueDate
    });
    const { data, error } = await db.from('projects').update(row).eq('id', a.projectId).select().single();
    if (error) throw error;
    return data;
  }

  if (name === 'create_task') {
    if (a.parentTempId || (Array.isArray(a.dependsOnTempIds) && a.dependsOnTempIds.length)) throw new Error('parentTempId och dependsOnTempIds används med bulk_create_tasks, inte create_task.');
    const task = await createTask(ctx, a);
    const links = await taskLinks([task.id]);
    return withLinks([task], links)[0];
  }

  if (name === 'bulk_create_tasks') {
    const tasks = Array.isArray(a.tasks) ? a.tasks : [];
    if (!tasks.length) throw new Error('bulk_create_tasks kräver minst en task.');
    if (tasks.length > 100) throw new Error('Skapa högst 100 tasks åt gången.');
    const tempIds = new Set(tasks.map(t => t.tempId).filter(Boolean));
    for (const task of tasks) {
      if (Array.isArray(task.dependsOnTempIds) && task.dependsOnTempIds.length && !task.tempId) throw new Error('Tasks som använder dependsOnTempIds måste ha ett eget tempId.');
      if (task.parentTempId && !tempIds.has(task.parentTempId)) throw new Error(`Okänt parentTempId: ${task.parentTempId}`);
      for (const dep of task.dependsOnTempIds || []) if (!tempIds.has(dep)) throw new Error(`Okänt dependsOnTempId: ${dep}`);
    }
    if (a.dryRun) return { dryRun: true, wouldCreate: tasks.length, tempIds: [...tempIds] };

    const tempMap = new Map();
    const created = [];
    const orderedTasks = orderTasksForParents(tasks);
    for (const task of orderedTasks) {
      const hasDeferredDependencies = Array.isArray(task.dependsOnTempIds) && task.dependsOnTempIds.length > 0;
      const createdTask = await createTask(ctx, { ...task, dependsOnTempIds: [], hasDeferredDependencies }, tempMap, { defaultProjectId: a.defaultProjectId, defaultAssigneeId: a.defaultAssigneeId });
      if (task.tempId) tempMap.set(task.tempId, createdTask.id);
      created.push(createdTask);
    }
    const tempDependencyRows = [];
    for (const task of tasks) {
      if (!task.tempId || !Array.isArray(task.dependsOnTempIds)) continue;
      for (const tempDependencyId of task.dependsOnTempIds) {
        tempDependencyRows.push({ task_id: tempMap.get(task.tempId), depends_on_task_id: tempMap.get(tempDependencyId) });
      }
    }
    if (tempDependencyRows.length) {
      const { error } = await db.from('task_dependencies').insert(tempDependencyRows);
      if (error) throw error;
    }
    const links = await taskLinks(created.map(t => t.id));
    return { created: withLinks(created, links), tempIdMap: Object.fromEntries(tempMap.entries()) };
  }

  if (name === 'update_task') {
    return updateTask(ctx, a);
  }

  if (name === 'assign_task') {
    return updateTask(ctx, { taskId: a.taskId, assigneeId: a.assigneeId });
  }

  if (name === 'add_comment') {
    await allowedTask(a.taskId, ctx);
    const body = cleanText(a.body);
    if (!body) throw new Error('Kommentaren saknar text.');
    const { data, error } = await db.from('comments').insert({ task_id: a.taskId, author_id: actorId, body }).select().single();
    if (error) throw error;
    return data;
  }

  if (name === 'add_task_link') {
    await allowedTask(a.taskId, ctx);
    const [link] = normalizeLinks({ links: [a] });
    if (!link) throw new Error('Länken saknar innehåll.');
    const { data, error } = await db.from('task_links').insert({ ...link, task_id: a.taskId, created_by: actorId }).select().single();
    if (error) throw error;
    return data;
  }

  if (name === 'list_integrations') {
    return listIntegrations(ctx, a);
  }

  if (name === 'register_integration') {
    if (!['google_calendar', 'slack'].includes(a.provider)) throw new Error('provider måste vara google_calendar eller slack.');
    if (a.areaId) ensureAreaAccess(ctx, a.areaId);
    if (a.teamId && !ctx.teamIds.includes(a.teamId)) throw new Error('Ingen åtkomst till teamet.');
    const { data, error } = await db.from('integration_accounts').insert({
      provider: a.provider,
      owner_id: actorId,
      team_id: a.teamId || null,
      area_id: a.areaId || null,
      provider_user_id: a.providerUserId || '',
      provider_team_id: a.providerTeamId || '',
      display_name: a.displayName,
      scopes: Array.isArray(a.scopes) ? a.scopes : [],
      token_ref: a.tokenRef || '',
      settings: a.settings || {},
      status: a.status || 'needs_auth'
    }).select().single();
    if (error) throw error;
    return data;
  }

  if (name === 'schedule_task_on_calendar') {
    const link = await createCalendarLink(ctx, a, a.providerEventId ? 'synced' : 'pending');
    const { data: event, error } = await db.from('integration_events').insert({
      provider: 'google_calendar',
      integration_account_id: a.integrationAccountId,
      area_id: areaForProject(ctx, (await allowedTask(a.taskId, ctx)).project_id)?.id || null,
      event_type: 'calendar_sync_requested',
      external_id: a.providerEventId || '',
      payload: { taskId: a.taskId, calendarLinkId: link.id, startAt: a.startAt, endAt: a.endAt, title: a.title }
    }).select().single();
    if (error) throw error;
    return { calendarLink: link, syncEvent: event };
  }

  if (name === 'link_calendar_event') {
    return createCalendarLink(ctx, a, 'synced');
  }

  if (name === 'link_slack_message') {
    return createSlackLink(ctx, a);
  }

  if (name === 'create_task_from_slack') {
    await allowedIntegration(a.integrationAccountId, ctx, 'slack');
    const task = await createTask(ctx, {
      title: a.title,
      notes: a.notes || a.text || '',
      assigneeId: a.assigneeId,
      projectId: a.projectId,
      bucket: a.bucket || 'inbox',
      priority: a.priority || 3,
      due: a.due || '',
      dueAt: a.dueAt,
      reminderAt: a.reminderAt,
      links: a.permalink ? [{ kind: 'chat', provider: 'Slack', title: 'Slack-meddelande', url: a.permalink, externalId: a.messageTs, metadata: { channelId: a.channelId, threadTs: a.threadTs || '' } }] : []
    });
    const slackLink = await createSlackLink(ctx, { ...a, taskId: task.id });
    return { task, slackLink };
  }

  if (name === 'ingest_integration_event') {
    if (!['google_calendar', 'slack'].includes(a.provider)) throw new Error('provider måste vara google_calendar eller slack.');
    const integration = a.integrationAccountId ? await allowedIntegration(a.integrationAccountId, ctx, a.provider) : null;
    const areaId = a.areaId || integration?.area_id || null;
    if (areaId) ensureAreaAccess(ctx, areaId);
    if (!integration && !areaId) throw new Error('Ange integrationAccountId eller areaId.');
    const { data, error } = await db.from('integration_events').insert({
      provider: a.provider,
      integration_account_id: a.integrationAccountId || null,
      area_id: areaId,
      event_type: a.eventType,
      external_id: a.externalId || '',
      payload: a.payload || {},
      processed_at: a.triggerName && areaId ? new Date().toISOString() : null
    }).select().single();
    if (error) throw error;
    let taskEvent = null;
    if (a.triggerName && areaId) {
      const result = await db.from('task_events').insert({ area_id: areaId, name: a.triggerName, payload: a.payload || {}, actor_id: actorId }).select().single();
      if (result.error) throw result.error;
      taskEvent = result.data;
    }
    return { integrationEvent: data, taskEvent };
  }

  if (name === 'complete_task') {
    return updateTask(ctx, { taskId: a.taskId, completed: true });
  }

  if (name === 'emit_event') {
    ensureAreaAccess(ctx, a.areaId);
    const { data, error } = await db.from('task_events').insert({ area_id: a.areaId, name: a.name, payload: a.payload || {}, actor_id: actorId }).select().single();
    if (error) throw error;
    return data;
  }

  if (name === 'daily_brief') {
    const date = a.date || todayISO();
    const tasks = await listTasks(ctx, { areaId: a.areaId });
    const links = await taskLinks(tasks.map(t => t.id));
    const brief = buildBrief(tasks, links, date);

    if (a.save !== false) {
      const { data, error } = await db.from('daily_briefs').insert({
        user_id: actorId,
        area_id: a.areaId || null,
        brief_date: date,
        title: brief.title,
        summary: brief.summary,
        focus_task_ids: brief.focusTaskIds,
        blockers: brief.blockers,
        suggestions: brief.suggestions,
        generated_by: 'orbit-mcp-agent'
      }).select().single();
      if (error) throw error;
      return { ...brief, savedBriefId: data.id };
    }

    return brief;
  }

  if (name === 'agent_suggest_next_actions') {
    const tasks = await listTasks(ctx, { areaId: a.areaId });
    const links = await taskLinks(tasks.map(t => t.id));
    const brief = buildBrief(tasks, links);
    const result = {
      goal: a.goal || 'Planera nästa rimliga steg',
      proposedActions: brief.suggestions,
      focusTasks: brief.focusTasks,
      blockers: brief.blockers,
      note: 'Förslagen är read-only. Använd create_task, bulk_create_tasks, update_task eller assign_task när du uttryckligen vill ändra appen.'
    };

    if (a.save !== false) {
      const { data, error } = await db.from('agent_runs').insert({
        user_id: actorId,
        area_id: a.areaId || null,
        goal: result.goal,
        status: 'done',
        result,
        completed_at: new Date().toISOString()
      }).select().single();
      if (error) throw error;
      return { ...result, agentRunId: data.id };
    }

    return result;
  }

  throw new Error('Okänt verktyg');
}

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', async line => {
  let m;
  try {
    m = JSON.parse(line);
    let result;
    if (m.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'orbit-cloud', version: '0.4.0' } };
    else if (m.method === 'tools/list') result = { tools };
    else if (m.method === 'tools/call') result = { content: [{ type: 'text', text: JSON.stringify(await call(m.params.name, m.params.arguments || {}), null, 2) }] };
    else if (m.method?.startsWith('notifications/')) return;
    else result = {};
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m?.id || null, error: { code: -32603, message: e.message } }) + '\n');
  }
});
