-- Private token storage for server-side integration workers.
-- Tokens are encrypted by the Vercel backend before being written here.

create table if not exists private.integration_tokens (
  id uuid primary key default gen_random_uuid(),
  integration_account_id uuid not null references public.integration_accounts(id) on delete cascade,
  provider text not null check(provider in ('google_calendar','slack')),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  encrypted_payload text not null,
  iv text not null,
  tag text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(integration_account_id)
);

alter table private.integration_tokens enable row level security;

revoke all on table private.integration_tokens from public, anon, authenticated;
grant select, insert, update, delete on table private.integration_tokens to service_role;

drop policy if exists "service role manages integration tokens" on private.integration_tokens;
create policy "service role manages integration tokens"
on private.integration_tokens
for all
to service_role
using (true)
with check (true);

create index if not exists integration_tokens_integration_idx
on private.integration_tokens(integration_account_id);

create index if not exists integration_tokens_owner_provider_idx
on private.integration_tokens(owner_id, provider);

create or replace function public.store_integration_token(
  p_integration_account_id uuid,
  p_provider text,
  p_owner_id uuid,
  p_encrypted_payload text,
  p_iv text,
  p_tag text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare stored_id uuid;
begin
  insert into private.integration_tokens(
    integration_account_id,
    provider,
    owner_id,
    encrypted_payload,
    iv,
    tag,
    updated_at
  )
  values (
    p_integration_account_id,
    p_provider,
    p_owner_id,
    p_encrypted_payload,
    p_iv,
    p_tag,
    now()
  )
  on conflict (integration_account_id)
  do update set
    provider=excluded.provider,
    owner_id=excluded.owner_id,
    encrypted_payload=excluded.encrypted_payload,
    iv=excluded.iv,
    tag=excluded.tag,
    updated_at=now()
  returning id into stored_id;

  return stored_id;
end;
$$;

create or replace function public.get_integration_token(p_integration_account_id uuid)
returns table (
  encrypted_payload text,
  iv text,
  tag text
)
language sql
stable
security definer
set search_path=''
as $$
  select it.encrypted_payload, it.iv, it.tag
  from private.integration_tokens it
  where it.integration_account_id=p_integration_account_id
  limit 1
$$;

revoke execute on function public.store_integration_token(uuid, text, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.get_integration_token(uuid) from public, anon, authenticated;
grant execute on function public.store_integration_token(uuid, text, uuid, text, text, text) to service_role;
grant execute on function public.get_integration_token(uuid) to service_role;
