-- Internal trigger/helper functions should not be callable directly through the REST/RPC API.
-- Triggers can still execute these functions as table owner/database internals.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.resolve_task_flow() from public, anon, authenticated;
revoke execute on function public.resolve_external_event() from public, anon, authenticated;
revoke execute on function public.evaluate_task_dependencies(uuid) from public, anon, authenticated;
revoke execute on function public.orbit_task_activity() from public, anon, authenticated;
revoke execute on function public.orbit_recreate_recurring_task() from public, anon, authenticated;
revoke execute on function public.orbit_comment_activity() from public, anon, authenticated;
revoke execute on function public.process_scheduled_activations() from public, anon, authenticated;
revoke execute on function public.orbit_task_created_activity() from public, anon, authenticated;
