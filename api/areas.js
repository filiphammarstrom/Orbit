import { HttpError, adminClient, authenticatedUser, requireMethod, sendError } from './_lib/orbit-server.js';
import { firstIcon, requestBody } from './_lib/request.js';

async function assertCanUseTeam(userId, teamId) {
  if (!teamId) return;
  const { data: team, error: teamError } = await adminClient()
    .from('teams')
    .select('id,owner_id')
    .eq('id', teamId)
    .maybeSingle();
  if (teamError) throw new HttpError(500, teamError.message);
  if (team?.owner_id === userId) return;

  const { data: member, error: memberError } = await adminClient()
    .from('team_members')
    .select('team_id')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .in('role', ['owner', 'admin'])
    .maybeSingle();
  if (memberError) throw new HttpError(500, memberError.message);
  if (!member) throw new HttpError(403, 'Du kan inte dela området med det teamet.');
}

export default async function handler(req, res) {
  try {
    requireMethod(req, 'POST');
    const user = await authenticatedUser(req);
    const body = requestBody(req);
    const name = String(body.name || '').trim();
    const category = String(body.category || 'Privat').trim() || 'Privat';
    const teamId = body.teamId || null;
    if (!name) throw new HttpError(400, 'Området behöver ett namn.');

    await assertCanUseTeam(user.id, teamId);

    const { data, error } = await adminClient()
      .from('areas')
      .insert({
        name: name.slice(0, 120),
        category: category.slice(0, 80),
        icon: firstIcon(body.icon, '📁'),
        color: body.color || '#7659ef',
        owner_id: user.id,
        team_id: teamId
      })
      .select()
      .single();

    if (error) throw new HttpError(500, error.message);
    res.status(200).json({ area: data });
  } catch (error) {
    sendError(res, error);
  }
}
