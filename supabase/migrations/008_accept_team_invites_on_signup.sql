-- Make team invitations useful before the email/OAuth worker exists:
-- if an invited email already has an account, accept the invite immediately;
-- if the user signs up later with that email, accept all pending invites then.

create or replace function public.accept_matching_team_invitation() returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  invited_user uuid;
begin
  new.email := lower(trim(new.email));

  select u.id into invited_user
  from auth.users u
  where lower(u.email) = new.email
  limit 1;

  if invited_user is not null and new.accepted_at is null and new.expires_at > now() then
    insert into public.team_members(team_id, user_id, role, status)
    values(new.team_id, invited_user, new.role, 'active')
    on conflict (team_id, user_id)
    do update set role = excluded.role, status = 'active';

    new.accepted_at := now();
  end if;

  return new;
end $$;

drop trigger if exists invitation_before_write on public.invitations;
create trigger invitation_before_write
before insert or update of email, role, expires_at, accepted_at on public.invitations
for each row execute function public.accept_matching_team_invitation();

create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.profiles(id, name, initials)
  values(
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    upper(left(coalesce(new.raw_user_meta_data->>'name', new.email), 2))
  )
  on conflict (id) do nothing;

  insert into public.areas(name, icon, color, owner_id)
  values('Privat', '⌂', '#49a58f', new.id);

  insert into public.team_members(team_id, user_id, role, status)
  select i.team_id, new.id, i.role, 'active'
  from public.invitations i
  where lower(i.email) = lower(new.email)
    and i.accepted_at is null
    and i.expires_at > now()
  on conflict (team_id, user_id)
  do update set role = excluded.role, status = 'active';

  update public.invitations i
  set accepted_at = now()
  where lower(i.email) = lower(new.email)
    and i.accepted_at is null
    and i.expires_at > now();

  return new;
end $$;

revoke execute on function public.accept_matching_team_invitation() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
