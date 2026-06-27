import {
  requireMethod,
  sendError
} from './_lib/orbit-server.js';
import {
  checkWebhookAuth,
  emitExternalTaskEvent,
  requestBody
} from './_lib/external-triggers.js';

export default async function handler(req, res) {
  try {
    requireMethod(req, 'POST');
    checkWebhookAuth(req);

    const body = requestBody(req);
    const result = await emitExternalTaskEvent({
      ...body,
      source: body.source || 'external_webhook'
    });

    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
}
