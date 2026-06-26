import {
  HttpError,
  authenticatedUser,
  requireMethod,
  sendError,
  userClient
} from './_lib/orbit-server.js';
import {
  markCalendarLinkFailed,
  syncCalendarLink
} from './google-calendar-sync.js';

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

export default async function handler(req, res) {
  let link;

  try {
    requireMethod(req, 'POST');
    await authenticatedUser(req);

    const { calendarLinkId } = requestBody(req);
    if (!calendarLinkId) throw new HttpError(400, 'calendarLinkId saknas.');

    const db = userClient(req);
    const { data, error } = await db
      .from('task_calendar_links')
      .select('*')
      .eq('id', calendarLinkId)
      .single();
    if (error || !data) throw new HttpError(404, 'Kalenderlänken hittades inte eller saknar åtkomst.');

    link = data;
    const result = await syncCalendarLink(link);
    res.status(200).json({ result });
  } catch (error) {
    if (link) {
      try {
        await markCalendarLinkFailed(link, error);
      } catch {
        // Keep the original error as the client-facing failure.
      }
    }
    sendError(res, error);
  }
}
