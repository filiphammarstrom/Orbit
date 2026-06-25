-- Integrationsgrund för Google Calendar och Slack.
-- Kör efter 004_ai_control_notifications.sql.

create table if not exists public.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('google_calendar','slack')),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  area_id uuid references public.areas(id) on delete cascade,
  provider_user_id text not null default '',
  provider_team_id text not null default '',
  display_name text not null default '',
  scopes text[] not null default '{}',
  token_ref text not null default '',
  settings jsonb not null default '{}',
  status text not null default 'active' check(status in ('active','paused','revoked','needs_auth')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_calendar_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  integration_account_id uuid not null references public.integration_accounts(id) on delete cascade,
  calendar_id text not null default 'primary',
  provider_event_id text not null default '',
  event_url text not null default '',
  sync_direction text not null default 'orbit_to_calendar' check(sync_direction in ('orbit_to_calendar','calendar_to_orbit','two_way')),
  status text not null default 'pending' check(status in ('pending','synced','failed','deleted')),
  start_at timestamptz,
  end_at timestamptz,
  time_zone text not null default 'Europe/Stockholm',
  payload jsonb not null default '{}',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.slack_message_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  integration_account_id uuid not null references public.integration_accounts(id) on delete cascade,
  channel_id text not null,
  message_ts text not null,
  thread_ts text not null default '',
  permalink text not null default '',
  author_external_id text not null default '',
  text_snapshot text not null default '',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(integration_account_id, channel_id, message_ts)
);

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('google_calendar','slack')),
  integration_account_id uuid references public.integration_accounts(id) on delete set null,
  area_id uuid references public.areas(id) on delete cascade,
  event_type text not null,
  external_id text not null default '',
  payload jsonb not null default '{}',
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function private.can_access_integration(wanted_integration uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.integration_accounts ia
    where ia.id=wanted_integration
      and (
        ia.owner_id=(select auth.uid())
        or (ia.area_id is not null and private.can_access_area(ia.area_id))
        or (
          ia.team_id is not null
          and exists(
            select 1 from public.team_members tm
            where tm.team_id=ia.team_id
              and tm.user_id=(select auth.uid())
              and tm.status='active'
          )
        )
      )
  )
$$;
grant execute on function private.can_access_integration(uuid) to authenticated;

alter table public.integration_accounts enable row level security;
alter table public.task_calendar_links enable row level security;
alter table public.slack_message_links enable row level security;
alter table public.integration_events enable row level security;

create policy "integrations accessible read" on public.integration_accounts for select to authenticated
using(private.can_access_integration(id));

create policy "integrations owner insert" on public.integration_accounts for insert to authenticated
with check(
  owner_id=(select auth.uid())
  and (integration_accounts.area_id is null or private.can_access_area(integration_accounts.area_id))
  and (
    integration_accounts.team_id is null
    or private.can_admin_team(integration_accounts.team_id)
    or exists(
      select 1 from public.team_members tm
      where tm.team_id=integration_accounts.team_id
        and tm.user_id=(select auth.uid())
        and tm.status='active'
    )
  )
);

create policy "integrations owner update" on public.integration_accounts for update to authenticated
using(owner_id=(select auth.uid()) or (integration_accounts.team_id is not null and private.can_admin_team(integration_accounts.team_id)))
with check(owner_id=(select auth.uid()) or (integration_accounts.team_id is not null and private.can_admin_team(integration_accounts.team_id)));

create policy "calendar links task read" on public.task_calendar_links for select to authenticated
using(exists(select 1 from public.tasks t where t.id=task_id));

create policy "calendar links task write" on public.task_calendar_links for all to authenticated
using(exists(select 1 from public.tasks t where t.id=task_id) and private.can_access_integration(integration_account_id))
with check(exists(select 1 from public.tasks t where t.id=task_id) and private.can_access_integration(integration_account_id));

create policy "slack links task read" on public.slack_message_links for select to authenticated
using((task_id is null and private.can_access_integration(integration_account_id)) or exists(select 1 from public.tasks t where t.id=task_id));

create policy "slack links task write" on public.slack_message_links for all to authenticated
using(private.can_access_integration(integration_account_id) and (task_id is null or exists(select 1 from public.tasks t where t.id=task_id)))
with check(private.can_access_integration(integration_account_id) and (task_id is null or exists(select 1 from public.tasks t where t.id=task_id)));

create policy "integration events read" on public.integration_events for select to authenticated
using((integration_account_id is not null and private.can_access_integration(integration_account_id)) or (area_id is not null and private.can_access_area(area_id)));

create policy "integration events insert" on public.integration_events for insert to authenticated
with check((integration_account_id is not null and private.can_access_integration(integration_account_id)) or (area_id is not null and private.can_access_area(area_id)));

create index if not exists integration_accounts_provider_owner_idx on public.integration_accounts(provider, owner_id);
create index if not exists task_calendar_links_task_idx on public.task_calendar_links(task_id);
create unique index if not exists task_calendar_links_provider_event_unique_idx on public.task_calendar_links(integration_account_id, calendar_id, provider_event_id) where provider_event_id<>'';
create index if not exists slack_message_links_task_idx on public.slack_message_links(task_id);
create index if not exists integration_events_provider_created_idx on public.integration_events(provider, created_at desc);

do $$ begin alter publication supabase_realtime add table public.task_calendar_links; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.slack_message_links; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.integration_events; exception when duplicate_object then null; end $$;
