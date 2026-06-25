-- Avancerad projekthantering för Orbit. Kör efter schema.sql.
alter table public.projects add column if not exists objective text not null default '';
alter table public.projects add column if not exists owner_id uuid references public.profiles(id);
alter table public.projects add column if not exists status text not null default 'planned' check(status in ('planned','active','paused','completed'));
alter table public.projects add column if not exists health text not null default 'on_track' check(health in ('on_track','at_risk','off_track'));
alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists due_date date;

alter table public.tasks add column if not exists status text not null default 'todo' check(status in ('idea','planned','todo','doing','waiting','review','done'));
alter table public.tasks add column if not exists task_type text not null default 'task' check(task_type in ('task','milestone','approval'));
alter table public.tasks add column if not exists activation_mode text not null default 'all' check(activation_mode in ('all','any'));
alter table public.tasks add column if not exists activated_at timestamptz;
alter table public.tasks add column if not exists activation_reason text;
alter table public.tasks add column if not exists recurrence_rule text;
alter table public.tasks add column if not exists activate_after timestamptz;

create table if not exists public.task_dependencies (
  task_id uuid references public.tasks(id) on delete cascade,
  depends_on_task_id uuid references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(task_id,depends_on_task_id), check(task_id<>depends_on_task_id)
);
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id), body text not null check(length(body) between 1 and 10000), created_at timestamptz not null default now(), edited_at timestamptz
);
create table if not exists public.task_followers (
  task_id uuid references public.tasks(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(task_id,user_id)
);
create table if not exists public.activity_log (
  id bigint generated always as identity primary key, task_id uuid references public.tasks(id) on delete cascade,
  actor_id uuid references public.profiles(id), action text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade, type text not null, title text not null, body text not null default '',
  read_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks(id) on delete cascade,
  requested_from uuid not null references public.profiles(id), requested_by uuid not null references public.profiles(id),
  status text not null default 'pending' check(status in ('pending','approved','rejected')), note text, decided_at timestamptz, unique(task_id,requested_from)
);
create table if not exists public.project_templates (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id), area_id uuid references public.areas(id) on delete cascade,
  name text not null, description text not null default '', definition jsonb not null default '{"tasks":[]}', created_at timestamptz not null default now()
);

alter table public.task_dependencies enable row level security; alter table public.comments enable row level security;
alter table public.task_followers enable row level security; alter table public.activity_log enable row level security;
alter table public.notifications enable row level security; alter table public.approvals enable row level security;
alter table public.project_templates enable row level security;

create policy "dependencies task access" on public.task_dependencies for all to authenticated
using(exists(select 1 from public.tasks t where t.id=task_id)) with check(exists(select 1 from public.tasks t where t.id=task_id));
create policy "comments task read" on public.comments for select to authenticated using(exists(select 1 from public.tasks t where t.id=task_id));
create policy "comments author insert" on public.comments for insert to authenticated with check(author_id=(select auth.uid()) and exists(select 1 from public.tasks t where t.id=task_id));
create policy "comments author update" on public.comments for update to authenticated using(author_id=(select auth.uid())) with check(author_id=(select auth.uid()));
create policy "followers task access" on public.task_followers for all to authenticated using(exists(select 1 from public.tasks t where t.id=task_id)) with check(user_id=(select auth.uid()) and exists(select 1 from public.tasks t where t.id=task_id));
create policy "activity task read" on public.activity_log for select to authenticated using(exists(select 1 from public.tasks t where t.id=task_id));
create policy "notifications own" on public.notifications for select to authenticated using(user_id=(select auth.uid()));
create policy "notifications own update" on public.notifications for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy "approvals task read" on public.approvals for select to authenticated using(exists(select 1 from public.tasks t where t.id=task_id));
create policy "approvals requester insert" on public.approvals for insert to authenticated with check(requested_by=(select auth.uid()) and exists(select 1 from public.tasks t where t.id=task_id));
create policy "approvals recipient update" on public.approvals for update to authenticated using(requested_from=(select auth.uid())) with check(requested_from=(select auth.uid()));
create policy "templates area read" on public.project_templates for select to authenticated using(owner_id=(select auth.uid()) or (area_id is not null and private.can_access_area(area_id)));
create policy "templates owner write" on public.project_templates for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));

create or replace function public.evaluate_task_dependencies(changed_task uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  update public.tasks target set visible=true, activated_at=now(), activation_reason=case when target.activation_mode='all' then 'Alla föregående steg är klara' else 'Ett föregående steg är klart' end
  where not target.visible and exists(select 1 from public.task_dependencies d where d.task_id=target.id and d.depends_on_task_id=changed_task)
  and ((target.activation_mode='all' and not exists(select 1 from public.task_dependencies d join public.tasks source on source.id=d.depends_on_task_id where d.task_id=target.id and not source.completed))
    or (target.activation_mode='any' and exists(select 1 from public.task_dependencies d join public.tasks source on source.id=d.depends_on_task_id where d.task_id=target.id and source.completed)));
end $$;
create or replace function public.orbit_task_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.completed and not old.completed then perform public.evaluate_task_dependencies(new.id); end if;
  insert into public.activity_log(task_id,actor_id,action,details) values(new.id,(select auth.uid()),case when new.completed and not old.completed then 'completed' when new.assignee_id is distinct from old.assignee_id then 'assigned' when new.status is distinct from old.status then 'status_changed' else 'updated' end,jsonb_build_object('from_status',old.status,'to_status',new.status));
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null and new.assignee_id<>(select auth.uid()) then insert into public.notifications(user_id,task_id,type,title,body) values(new.assignee_id,new.id,'assignment','Ny uppgift tilldelad',new.title); end if;
  return new;
end $$;
drop trigger if exists orbit_task_activity_trigger on public.tasks;
create trigger orbit_task_activity_trigger after update on public.tasks for each row execute function public.orbit_task_activity();

create or replace function public.orbit_recreate_recurring_task() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.completed and not old.completed and new.recurrence_rule in ('daily','weekly','monthly') then
    insert into public.tasks(project_id,created_by,assignee_id,parent_task_id,title,notes,bucket,priority,due_text,status,task_type,recurrence_rule,visible)
    values(new.project_id,new.created_by,new.assignee_id,new.parent_task_id,new.title,new.notes,new.bucket,new.priority,new.due_text,'todo',new.task_type,new.recurrence_rule,true);
  end if;
  return new;
end $$;
drop trigger if exists orbit_recurring_task_trigger on public.tasks;
create trigger orbit_recurring_task_trigger after update of completed on public.tasks for each row execute function public.orbit_recreate_recurring_task();

create or replace function public.orbit_comment_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.activity_log(task_id,actor_id,action,details) values(new.task_id,new.author_id,'commented',jsonb_build_object('comment_id',new.id));
  insert into public.notifications(user_id,task_id,type,title,body)
    select distinct recipient,new.task_id,'comment','Ny kommentar',left(new.body,180) from (
      select t.created_by recipient from public.tasks t where t.id=new.task_id union select t.assignee_id from public.tasks t where t.id=new.task_id union select f.user_id from public.task_followers f where f.task_id=new.task_id
    ) people where recipient is not null and recipient<>new.author_id;
  return new;
end $$;
drop trigger if exists orbit_comment_activity_trigger on public.comments;
create trigger orbit_comment_activity_trigger after insert on public.comments for each row execute function public.orbit_comment_activity();

do $$ begin alter publication supabase_realtime add table public.comments; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end $$;

-- Kan köras varje minut med Supabase Cron för tidsbaserade villkor.
create or replace function public.process_scheduled_activations() returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  update public.tasks set visible=true,activated_at=now(),activation_reason='Den planerade tidpunkten har inträffat' where not visible and activate_after is not null and activate_after<=now();
  get diagnostics affected=row_count; return affected;
end $$;
