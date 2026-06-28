create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '', initials text not null default '', color text not null default '#7659ef',
  created_at timestamptz not null default now()
);
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(), name text not null, owner_id uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.team_members (
  team_id uuid references public.teams(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade,
  role text not null default 'member' check(role in ('owner','admin','member')), status text not null default 'active' check(status in ('active','invited')),
  primary key(team_id,user_id)
);
create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(), name text not null, icon text not null default '◫', color text not null default '#7659ef',
  category text not null default 'Privat',
  owner_id uuid not null references public.profiles(id), team_id uuid references public.teams(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(), area_id uuid not null references public.areas(id) on delete cascade,
  name text not null, icon text not null default '▣', color text not null default '#8b70ff', archived_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.category_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  icon text not null default '▣',
  color text not null default '#7659ef',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, name),
  check (char_length(trim(name)) > 0)
);
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id) on delete cascade,
  created_by uuid not null references public.profiles(id), assignee_id uuid references public.profiles(id), parent_task_id uuid references public.tasks(id) on delete cascade,
  title text not null, notes text not null default '', bucket text not null default 'inbox' check(bucket in ('inbox','today','later','someday')),
  priority smallint not null default 3 check(priority between 1 and 3), due_text text not null default '', due_at timestamptz, reminder_at timestamptz,
  completed boolean not null default false, completed_at timestamptz, visible boolean not null default true,
  trigger_type text check(trigger_type in ('task_completed','external_event')), trigger_task_id uuid references public.tasks(id) on delete set null, trigger_event text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((trigger_type is null) or (trigger_type='task_completed' and trigger_task_id is not null) or (trigger_type='external_event' and trigger_event is not null))
);
create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(), area_id uuid references public.areas(id) on delete cascade,
  name text not null, payload jsonb not null default '{}', actor_id uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams(id) on delete cascade,
  email text not null, role text not null default 'member' check(role in ('admin','member')), token uuid not null default gen_random_uuid(),
  invited_by uuid not null references public.profiles(id), expires_at timestamptz not null default now()+interval '7 days', accepted_at timestamptz,
  unique(team_id,email)
);

create or replace function public.accept_matching_team_invitation() returns trigger language plpgsql security definer set search_path='' as $$
declare invited_user uuid;
begin
  new.email := lower(trim(new.email));
  select u.id into invited_user from auth.users u where lower(u.email)=new.email limit 1;
  if invited_user is not null and new.accepted_at is null and new.expires_at > now() then
    insert into public.team_members(team_id,user_id,role,status) values(new.team_id,invited_user,new.role,'active')
    on conflict (team_id,user_id) do update set role=excluded.role,status='active';
    new.accepted_at := now();
  end if;
  return new;
end $$;

create or replace function private.is_team_member(wanted_team uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.team_members tm where tm.team_id=wanted_team and tm.user_id=(select auth.uid()) and tm.status='active')
$$;
create or replace function private.can_access_area(wanted_area uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.areas a where a.id=wanted_area and (a.owner_id=(select auth.uid()) or (a.team_id is not null and private.is_team_member(a.team_id))))
$$;
create or replace function private.user_can_access_area(wanted_user uuid, wanted_area uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.areas a where a.id=wanted_area and (a.owner_id=wanted_user or exists(select 1 from public.team_members tm where tm.team_id=a.team_id and tm.user_id=wanted_user and tm.status='active')))
$$;
create or replace function private.can_admin_team(wanted_team uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.teams t where t.id=wanted_team and t.owner_id=(select auth.uid())) or
         exists(select 1 from public.team_members tm where tm.team_id=wanted_team and tm.user_id=(select auth.uid()) and tm.role in ('owner','admin') and tm.status='active')
$$;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

alter table public.profiles enable row level security; alter table public.teams enable row level security;
alter table public.team_members enable row level security; alter table public.areas enable row level security;
alter table public.projects enable row level security; alter table public.tasks enable row level security;
alter table public.task_events enable row level security; alter table public.invitations enable row level security;
alter table public.category_settings enable row level security;

grant select, insert, update, delete on public.category_settings to authenticated;

create policy "profile self or teammate read" on public.profiles for select to authenticated using (
 id=(select auth.uid()) or exists(select 1 from public.team_members mine join public.team_members theirs on theirs.team_id=mine.team_id where mine.user_id=(select auth.uid()) and theirs.user_id=profiles.id and mine.status='active')
);
create policy "profile self update" on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy "teams member read" on public.teams for select to authenticated using(owner_id=(select auth.uid()) or private.is_team_member(id));
create policy "teams owner insert" on public.teams for insert to authenticated with check(owner_id=(select auth.uid()));
create policy "teams admins update" on public.teams for update to authenticated using(private.can_admin_team(id)) with check(private.can_admin_team(id));
create policy "members same team read" on public.team_members for select to authenticated using(private.is_team_member(team_id) or private.can_admin_team(team_id));
create policy "members admins write" on public.team_members for all to authenticated using(private.can_admin_team(team_id)) with check(private.can_admin_team(team_id));
create policy "areas member read" on public.areas for select to authenticated using(private.can_access_area(id));
create policy "areas owner insert" on public.areas for insert to authenticated with check(owner_id=(select auth.uid()) and (team_id is null or private.can_admin_team(team_id)));
create policy "areas owner update" on public.areas for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy "projects area read" on public.projects for select to authenticated using(private.can_access_area(area_id));
create policy "projects area write" on public.projects for all to authenticated using(private.can_access_area(area_id)) with check(private.can_access_area(area_id));
create policy "category settings owner read" on public.category_settings for select to authenticated using(owner_id=(select auth.uid()));
create policy "category settings owner insert" on public.category_settings for insert to authenticated with check(owner_id=(select auth.uid()));
create policy "category settings owner update" on public.category_settings for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy "category settings owner delete" on public.category_settings for delete to authenticated using(owner_id=(select auth.uid()));
create policy "tasks permitted read" on public.tasks for select to authenticated using(created_by=(select auth.uid()) or project_id in (select p.id from public.projects p where private.can_access_area(p.area_id)));
create policy "tasks permitted insert" on public.tasks for insert to authenticated with check(created_by=(select auth.uid()) and (project_id is null or exists(select 1 from public.projects p where p.id=project_id and private.can_access_area(p.area_id) and (assignee_id is null or private.user_can_access_area(assignee_id,p.area_id)))));
create policy "tasks permitted update" on public.tasks for update to authenticated using(created_by=(select auth.uid()) or project_id in (select p.id from public.projects p where private.can_access_area(p.area_id))) with check(project_id is null or exists(select 1 from public.projects p where p.id=project_id and private.can_access_area(p.area_id) and (assignee_id is null or private.user_can_access_area(assignee_id,p.area_id))));
create policy "events area read" on public.task_events for select to authenticated using(private.can_access_area(area_id));
create policy "events area insert" on public.task_events for insert to authenticated with check(actor_id=(select auth.uid()) and private.can_access_area(area_id));
create policy "invites admins" on public.invitations for all to authenticated using(private.can_admin_team(team_id)) with check(private.can_admin_team(team_id) and invited_by=(select auth.uid()));

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,name,initials)
  values(new.id,coalesce(new.raw_user_meta_data->>'name',split_part(new.email,'@',1)),upper(left(coalesce(new.raw_user_meta_data->>'name',new.email),2)))
  on conflict (id) do nothing;
  insert into public.category_settings(owner_id,name,icon,color) values(new.id,'Privat','⌂','#49a58f')
  on conflict (owner_id,name) do nothing;
  insert into public.areas(name,icon,color,category,owner_id) values('Allmänt','⌂','#49a58f','Privat',new.id);
  insert into public.team_members(team_id,user_id,role,status)
  select i.team_id,new.id,i.role,'active' from public.invitations i
  where lower(i.email)=lower(new.email) and i.accepted_at is null and i.expires_at>now()
  on conflict (team_id,user_id) do update set role=excluded.role,status='active';
  update public.invitations i set accepted_at=now()
  where lower(i.email)=lower(new.email) and i.accepted_at is null and i.expires_at>now();
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

drop trigger if exists invitation_before_write on public.invitations;
create trigger invitation_before_write before insert or update of email, role, expires_at, accepted_at on public.invitations for each row execute function public.accept_matching_team_invitation();

revoke execute on function public.accept_matching_team_invitation() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.resolve_task_flow() returns trigger language plpgsql security definer set search_path='' as $$
declare parent uuid;
begin
  new.updated_at=now(); if new.completed and not old.completed then new.completed_at=now(); end if;
  if new.completed then update public.tasks set visible=true where trigger_type='task_completed' and trigger_task_id=new.id and not visible; end if;
  parent:=new.parent_task_id;
  if parent is not null then update public.tasks p set completed=not exists(select 1 from public.tasks c where c.parent_task_id=parent and not c.completed), updated_at=now() where p.id=parent; end if;
  return new;
end $$;
drop trigger if exists task_flow_after_update on public.tasks;
create trigger task_flow_after_update after update of completed on public.tasks for each row execute function public.resolve_task_flow();

create or replace function public.resolve_external_event() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.tasks t set visible=true where t.trigger_type='external_event' and t.trigger_event=new.name and t.project_id in(select p.id from public.projects p where p.area_id=new.area_id); return new; end $$;
drop trigger if exists task_event_after_insert on public.task_events;
create trigger task_event_after_insert after insert on public.task_events for each row execute function public.resolve_external_event();

do $$ begin alter publication supabase_realtime add table public.tasks; exception when duplicate_object then null; end $$;
