create or replace function public.set_area_owner_from_auth()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.owner_id is null then
    new.owner_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_area_owner_from_auth on public.areas;
create trigger set_area_owner_from_auth
before insert on public.areas
for each row
execute function public.set_area_owner_from_auth();

drop policy if exists "areas owner insert" on public.areas;
create policy "areas owner insert" on public.areas
for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and (
    team_id is null
    or private.can_admin_team(team_id)
  )
);
