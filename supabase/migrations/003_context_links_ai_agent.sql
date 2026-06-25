-- Kontextlänkar, daglig briefing och agentkörningar för Orbit. Kör efter 002_project_management.sql.

create table if not exists public.task_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  kind text not null default 'other' check(kind in ('email','calendar','document','chat','web','file','mcp','other')),
  provider text not null default '',
  title text not null default '',
  url text not null default '',
  external_id text not null default '',
  metadata jsonb not null default '{}',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check(length(url) <= 4000)
);

create table if not exists public.daily_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  area_id uuid references public.areas(id) on delete cascade,
  brief_date date not null default current_date,
  title text not null default 'Dagens sammanfattning',
  summary text not null default '',
  focus_task_ids uuid[] not null default '{}',
  blockers jsonb not null default '[]',
  suggestions jsonb not null default '[]',
  generated_by text not null default 'orbit-agent',
  created_at timestamptz not null default now()
);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  area_id uuid references public.areas(id) on delete cascade,
  goal text not null,
  status text not null default 'done' check(status in ('queued','running','done','failed')),
  result jsonb not null default '{}',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.task_links enable row level security;
alter table public.daily_briefs enable row level security;
alter table public.agent_runs enable row level security;

create policy "links task read" on public.task_links for select to authenticated
using(exists(select 1 from public.tasks t where t.id=task_id));

create policy "links task insert" on public.task_links for insert to authenticated
with check(created_by=(select auth.uid()) and exists(select 1 from public.tasks t where t.id=task_id));

create policy "links author update" on public.task_links for update to authenticated
using(created_by=(select auth.uid()) and exists(select 1 from public.tasks t where t.id=task_id))
with check(created_by=(select auth.uid()) and exists(select 1 from public.tasks t where t.id=task_id));

create policy "links author delete" on public.task_links for delete to authenticated
using(created_by=(select auth.uid()));

create policy "briefs own read" on public.daily_briefs for select to authenticated
using(user_id=(select auth.uid()) or (area_id is not null and private.can_access_area(area_id)));

create policy "briefs own insert" on public.daily_briefs for insert to authenticated
with check(user_id=(select auth.uid()) and (area_id is null or private.can_access_area(area_id)));

create policy "briefs own update" on public.daily_briefs for update to authenticated
using(user_id=(select auth.uid()))
with check(user_id=(select auth.uid()) and (area_id is null or private.can_access_area(area_id)));

create policy "agent runs own read" on public.agent_runs for select to authenticated
using(user_id=(select auth.uid()) or (area_id is not null and private.can_access_area(area_id)));

create policy "agent runs own insert" on public.agent_runs for insert to authenticated
with check(user_id=(select auth.uid()) and (area_id is null or private.can_access_area(area_id)));

create policy "agent runs own update" on public.agent_runs for update to authenticated
using(user_id=(select auth.uid()))
with check(user_id=(select auth.uid()) and (area_id is null or private.can_access_area(area_id)));

create index if not exists task_links_task_id_idx on public.task_links(task_id);
create index if not exists daily_briefs_user_date_idx on public.daily_briefs(user_id, brief_date desc, created_at desc);
create index if not exists agent_runs_user_created_idx on public.agent_runs(user_id, created_at desc);

do $$ begin alter publication supabase_realtime add table public.task_links; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.daily_briefs; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.agent_runs; exception when duplicate_object then null; end $$;
