import { HttpError, adminClient, authenticatedUser, requireMethod, sendError } from './_lib/orbit-server.js';
import { firstIcon, requestBody } from './_lib/request.js';

export default async function handler(req, res) {
  try {
    requireMethod(req, 'POST');
    const user = await authenticatedUser(req);
    const body = requestBody(req);
    const name = String(body.name || '').trim() || 'Privat';

    const { data, error } = await adminClient()
      .from('category_settings')
      .upsert({
        owner_id: user.id,
        name: name.slice(0, 80),
        icon: firstIcon(body.icon, '📁'),
        color: body.color || '#7659ef',
        updated_at: new Date().toISOString()
      }, { onConflict: 'owner_id,name' })
      .select()
      .single();

    if (error) throw new HttpError(500, error.message);
    res.status(200).json({ category: data });
  } catch (error) {
    sendError(res, error);
  }
}
