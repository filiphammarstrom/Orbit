import {
  HttpError,
  requireMethod,
  sendError
} from './_lib/orbit-server.js';
import {
  checkWebhookAuth,
  cleanText,
  emitExternalTaskEvent,
  requestBody
} from './_lib/external-triggers.js';

function emailFrom(value = '') {
  const text = cleanText(value).toLowerCase();
  const match = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match?.[0] || '';
}

function gmailEventName(body = {}) {
  const explicit = cleanText(body.name || body.triggerName || body.eventName || body.trigger_event);
  if (explicit) return explicit;

  const sender = emailFrom(body.from || body.sender || body.email || body.message?.from || body.payload?.from);
  if (sender) return `gmail_reply:${sender}`;

  throw new HttpError(400, 'Ange name/triggerName eller en avsändare så Orbit kan skapa triggernamnet.');
}

function gmailExternalId(body = {}) {
  return cleanText(
    body.externalId ||
    body.external_id ||
    body.messageId ||
    body.message_id ||
    body.threadId ||
    body.thread_id ||
    body.id
  );
}

function gmailPayload(body = {}) {
  const base = body.payload && typeof body.payload === 'object' ? body.payload : {};
  return {
    ...base,
    gmail: {
      from: cleanText(body.from || body.sender || body.message?.from || base.from),
      to: cleanText(body.to || body.message?.to || base.to),
      subject: cleanText(body.subject || body.message?.subject || base.subject),
      snippet: cleanText(body.snippet || body.text || body.message?.snippet || base.snippet),
      messageId: cleanText(body.messageId || body.message_id || body.message?.id || base.messageId),
      threadId: cleanText(body.threadId || body.thread_id || body.message?.threadId || base.threadId),
      url: cleanText(body.url || body.messageUrl || body.message_url || base.url)
    }
  };
}

export default async function handler(req, res) {
  try {
    requireMethod(req, 'POST');
    checkWebhookAuth(req);

    const body = requestBody(req);
    const result = await emitExternalTaskEvent({
      ...body,
      name: gmailEventName(body),
      source: 'gmail',
      externalId: gmailExternalId(body),
      payload: gmailPayload(body)
    });

    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
}
