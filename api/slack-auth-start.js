import { authenticatedUser, requireMethod, sendError, slackAuthUrl } from './_lib/orbit-server.js';

export default async function handler(req, res) {
  try {
    requireMethod(req, 'GET');
    const user = await authenticatedUser(req);
    res.status(200).json({ url: slackAuthUrl(req, user) });
  } catch (error) {
    sendError(res, error);
  }
}
