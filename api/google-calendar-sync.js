import {
  HttpError,
  adminClient,
  createGoogleCalendarEvent,
  loadIntegrationToken,
  refreshGoogleToken,
  requireEnv,
  sendError
} from './_lib/orbit-server.js';

function checkWorkerAuth(req) {
  const expected = requireEnv('CRON_SECRET');
  const actual = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (actual !== expected) throw new HttpError(401, 'Unauthorized.');
}

async function markLink(id, patch) {
  await adminClient()
    .from('task_calendar_links')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
}

async function loadTask(id) {
  const { data, error } = await adminClient().from('tasks').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function loadIntegration(id) {
  const { data, error } = await adminClient().from('integration_accounts').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function addCalendarTaskLink(taskId, event, calendarLinkId) {
  if (!event.htmlLink) return;
  if (event.id) {
    const { data: existing, error } = await adminClient()
      .from('task_links')
      .select('id')
      .eq('task_id', taskId)
      .eq('kind', 'calendar')
      .eq('external_id', event.id)
      .limit(1);
    if (error) throw error;
    if (existing?.length) return;
  }
  await adminClient().from('task_links').insert({
    task_id: taskId,
    kind: 'calendar',
    provider: 'Google Calendar',
    title: event.summary || 'Google Calendar-event',
    url: event.htmlLink,
    external_id: event.id || '',
    metadata: { calendarLinkId },
    created_by: (await loadTask(taskId)).created_by
  });
}

function googleEventId(linkId) {
  return `orbit${String(linkId).replace(/[^a-f0-9]/gi, '').toLowerCase()}`;
}

async function syncOne(link) {
  const [task, integration] = await Promise.all([
    loadTask(link.task_id),
    loadIntegration(link.integration_account_id)
  ]);

  if (integration.provider !== 'google_calendar') throw new Error('Integration är inte Google Calendar.');
  if (integration.status !== 'active') throw new Error('Google Calendar-kopplingen är inte aktiv.');

  const token = await refreshGoogleToken(integration, await loadIntegrationToken(integration.id));
  const calendarId = link.calendar_id || integration.settings?.calendarId || 'primary';
  const event = {
    id: googleEventId(link.id),
    summary: link.payload?.title || task.title,
    description: link.payload?.description || task.notes || '',
    start: { dateTime: link.start_at, timeZone: link.time_zone || 'Europe/Stockholm' },
    end: { dateTime: link.end_at, timeZone: link.time_zone || 'Europe/Stockholm' },
    extendedProperties: {
      private: {
        orbitTaskId: task.id,
        orbitCalendarLinkId: link.id
      }
    }
  };

  const googleEvent = await createGoogleCalendarEvent({
    accessToken: token.access_token,
    calendarId,
    event
  });

  await markLink(link.id, {
    status: 'synced',
    provider_event_id: googleEvent.id || '',
    event_url: googleEvent.htmlLink || '',
    last_synced_at: new Date().toISOString(),
    payload: { ...(link.payload || {}), googleEvent }
  });
  await addCalendarTaskLink(task.id, googleEvent, link.id);
  return { id: link.id, status: 'synced', eventUrl: googleEvent.htmlLink || '' };
}

export default async function handler(req, res) {
  try {
    if (!['GET', 'POST'].includes(req.method)) throw new HttpError(405, `Metoden ${req.method} stöds inte här.`);
    checkWorkerAuth(req);

    const limit = Math.min(Number(req.query.limit || 10), 25);
    const { data: links, error } = await adminClient()
      .from('task_calendar_links')
      .select('*')
      .eq('status', 'pending')
      .order('created_at')
      .limit(limit);
    if (error) throw error;

    const results = [];
    for (const link of links || []) {
      try {
        results.push(await syncOne(link));
      } catch (error) {
        await markLink(link.id, {
          status: 'failed',
          payload: { ...(link.payload || {}), syncError: error.message || 'Okänt fel' }
        });
        results.push({ id: link.id, status: 'failed', error: error.message || 'Okänt fel' });
      }
    }

    res.status(200).json({ processed: results.length, results });
  } catch (error) {
    sendError(res, error);
  }
}
