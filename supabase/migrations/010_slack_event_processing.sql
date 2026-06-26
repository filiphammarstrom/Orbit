-- Allow users with access to a Slack integration or area to mark integration events as processed.
-- This powers the Slack inbox review flow in the web app.

drop policy if exists "integration events update" on public.integration_events;
create policy "integration events update"
on public.integration_events
for update
to authenticated
using (
  (integration_account_id is not null and private.can_access_integration(integration_account_id))
  or (area_id is not null and private.can_access_area(area_id))
)
with check (
  (integration_account_id is not null and private.can_access_integration(integration_account_id))
  or (area_id is not null and private.can_access_area(area_id))
);

create index if not exists integration_events_unprocessed_idx
on public.integration_events(provider, processed_at, created_at desc);
