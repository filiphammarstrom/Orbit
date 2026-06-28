alter table public.projects
  add column if not exists icon text not null default '▣';

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

insert into public.category_settings(owner_id, name, icon, color)
select distinct on (owner_id, category)
  owner_id,
  category,
  coalesce(icon, '▣'),
  coalesce(color, '#7659ef')
from public.areas
where category is not null
on conflict (owner_id, name) do nothing;

alter table public.category_settings enable row level security;

grant select, insert, update, delete on public.category_settings to authenticated;

do $$
begin
  create policy "category settings owner read"
    on public.category_settings for select to authenticated
    using(owner_id = (select auth.uid()));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "category settings owner insert"
    on public.category_settings for insert to authenticated
    with check(owner_id = (select auth.uid()));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "category settings owner update"
    on public.category_settings for update to authenticated
    using(owner_id = (select auth.uid()))
    with check(owner_id = (select auth.uid()));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "category settings owner delete"
    on public.category_settings for delete to authenticated
    using(owner_id = (select auth.uid()));
exception when duplicate_object then null;
end $$;

comment on table public.category_settings is
  'Per-user visual settings for text-based category groupings above areas.';

comment on column public.projects.icon is
  'Small user-facing project icon shown in hierarchy navigation.';

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
