import {
  HttpError,
  adminClient,
  requireAnyEnv,
  requireMethod,
  sendError
} from './_lib/orbit-server.js';

function requestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      throw new HttpError(400, 'Ogiltig JSON-body.');
    }
  }
  return req.body;
}

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function webhookSecret() {
  return requireAnyEnv(['ORBIT_WEBHOOK_SECRET', 'CRON_SECRET']);
}

function checkWebhookAuth(req) {
  const expected = webhookSecret();
  const actual = cleanText(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!actual || actual !== expected) throw new HttpError(401, 'Unauthorized.');
}

async function loadArea(areaId) {
  const { data, error } = await adminClient()
    .from('areas')
    .select('id,name,owner_id,team_id')
    .eq('id', areaId)
    .single();
  if (error || !data) throw new HttpError(404, 'Området hittades inte.');
  return data;
}

async function actorCanEmit(area, actorId) {
  if (!actorId) return false;
  if (actorId === area.owner_id) return true;
  if (!area.team_id) return false;
  const { data, error } = await adminClient()
    .from('team_members')
    .select('user_id')
    .eq('team_id', area.team_id)
    .eq('user_id', actorId)
    .eq('status', 'active')
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function activatedTasks(areaId, eventName) {
  const { data: projects, error: projectError } = await adminClient()
    .from('projects')
    .select('id')
    .eq('area_id', areaId)
    .is('archived_at', null);
  if (projectError) throw projectError;
  const projectIds = (projects || []).map(project => project.id);
  if (!projectIds.length) return [];

  const { data, error } = await adminClient()
    .from('tasks')
    .select('id,title,project_id,visible')
    .eq('trigger_type', 'external_event')
    .eq('trigger_event', eventName)
    .eq('visible', true)
    .in('project_id', projectIds)
    .limit(50);
  if (error) throw error;
  return data || [];
}

export default async function handler(req, res) {
  try {
    requireMethod(req, 'POST');
    checkWebhookAuth(req);

    const body = requestBody(req);
    const areaId = cleanText(body.areaId || body.area_id);
    const name = cleanText(body.name || body.triggerName || body.eventName);
    if (!areaId) throw new HttpError(400, 'areaId saknas.');
    if (!name) throw new HttpError(400, 'Eventnamn saknas.');
    if (name.length > 160) throw new HttpError(400, 'Eventnamnet är för långt.');

    const area = await loadArea(areaId);
    const actorId = cleanText(body.actorId || body.actor_id || process.env.ORBIT_WEBHOOK_ACTOR_ID || area.owner_id);
    if (!await actorCanEmit(area, actorId)) throw new HttpError(403, 'Actor saknar åtkomst till området.');

    const now = new Date().toISOString();
    const payload = {
      ...(body.payload && typeof body.payload === 'object' ? body.payload : {}),
      orbitWebhook: {
        source: cleanText(body.source || 'external_webhook'),
        externalId: cleanText(body.externalId || body.external_id),
        receivedAt: now
      }
    };

    const { data: event, error } = await adminClient()
      .from('task_events')
      .insert({
        area_id: areaId,
        name,
        payload,
        actor_id: actorId
      })
      .select()
      .single();
    if (error) throw error;

    const tasks = await activatedTasks(areaId, name);
    res.status(200).json({
      ok: true,
      event,
      activatedTasks: tasks.map(task => ({ id: task.id, title: task.title }))
    });
  } catch (error) {
    sendError(res, error);
  }
}
