import { HttpError, adminClient, authenticatedUser, requireMethod, sendError } from './_lib/orbit-server.js';
import { firstIcon, requestBody } from './_lib/request.js';

async function assertCanUseArea(userId, areaId) {
  const { data: area, error } = await adminClient()
    .from('areas')
    .select('id,owner_id,team_id')
    .eq('id', areaId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!area) throw new HttpError(404, 'Området hittades inte.');
  if (area.owner_id === userId) return area;
  if (!area.team_id) throw new HttpError(403, 'Du har inte åtkomst till området.');

  const { data: member, error: memberError } = await adminClient()
    .from('team_members')
    .select('team_id')
    .eq('team_id', area.team_id)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (memberError) throw new HttpError(500, memberError.message);
  if (!member) throw new HttpError(403, 'Du har inte åtkomst till området.');
  return area;
}

export default async function handler(req, res) {
  try {
    requireMethod(req, 'POST');
    const user = await authenticatedUser(req);
    const body = requestBody(req);
    const name = String(body.name || '').trim();
    const areaId = body.areaId || '';
    if (!name) throw new HttpError(400, 'Projektet behöver ett namn.');
    if (!areaId) throw new HttpError(400, 'Välj område först.');

    await assertCanUseArea(user.id, areaId);

    const { data, error } = await adminClient()
      .from('projects')
      .insert({
        area_id: areaId,
        name: name.slice(0, 120),
        icon: firstIcon(body.icon, '✅'),
        color: body.color || '#8b70ff',
        owner_id: user.id
      })
      .select()
      .single();

    if (error) throw new HttpError(500, error.message);
    res.status(200).json({ project: data });
  } catch (error) {
    sendError(res, error);
  }
}
