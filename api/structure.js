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

async function createCategory(user, body) {
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
  return { category: data };
}

async function createArea(user, body) {
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
  return { area: data };
}

async function createProject(user, body) {
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
  return { project: data };
}

export default async function handler(req, res) {
  try {
    requireMethod(req, 'POST');
    const user = await authenticatedUser(req);
    const body = requestBody(req);
    const action = body.action || '';
    if (action === 'category') return res.status(200).json(await createCategory(user, body));
    if (action === 'area') return res.status(200).json(await createArea(user, body));
    if (action === 'project') return res.status(200).json(await createProject(user, body));
    throw new HttpError(400, 'Okänd strukturåtgärd.');
  } catch (error) {
    sendError(res, error);
  }
}
