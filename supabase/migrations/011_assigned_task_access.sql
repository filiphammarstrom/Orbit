-- Let assignees see project-less inbox tasks and allow assigning them to active teammates.

create or replace function private.user_shares_team_with_auth(wanted_user uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select wanted_user=(select auth.uid())
    or exists(
      select 1
      from public.team_members mine
      join public.team_members theirs on theirs.team_id=mine.team_id
      where mine.user_id=(select auth.uid())
        and theirs.user_id=wanted_user
        and mine.status='active'
        and theirs.status='active'
    )
$$;

grant execute on function private.user_shares_team_with_auth(uuid) to authenticated;

drop policy if exists "tasks permitted read" on public.tasks;
drop policy if exists "tasks permitted insert" on public.tasks;
drop policy if exists "tasks permitted update" on public.tasks;

create policy "tasks permitted read"
on public.tasks
for select
to authenticated
using (
  created_by=(select auth.uid())
  or assignee_id=(select auth.uid())
  or project_id in (
    select p.id
    from public.projects p
    where private.can_access_area(p.area_id)
  )
);

create policy "tasks permitted insert"
on public.tasks
for insert
to authenticated
with check (
  created_by=(select auth.uid())
  and (
    (
      project_id is null
      and (
        assignee_id is null
        or private.user_shares_team_with_auth(assignee_id)
      )
    )
    or exists(
      select 1
      from public.projects p
      where p.id=project_id
        and private.can_access_area(p.area_id)
        and (
          assignee_id is null
          or private.user_can_access_area(assignee_id,p.area_id)
        )
    )
  )
);

create policy "tasks permitted update"
on public.tasks
for update
to authenticated
using (
  created_by=(select auth.uid())
  or assignee_id=(select auth.uid())
  or project_id in (
    select p.id
    from public.projects p
    where private.can_access_area(p.area_id)
  )
)
with check (
  (
    project_id is null
    and (
      created_by=(select auth.uid())
      or assignee_id=(select auth.uid())
      or private.user_shares_team_with_auth(assignee_id)
    )
  )
  or exists(
    select 1
    from public.projects p
    where p.id=project_id
      and private.can_access_area(p.area_id)
      and (
        assignee_id is null
        or private.user_can_access_area(assignee_id,p.area_id)
      )
  )
);
