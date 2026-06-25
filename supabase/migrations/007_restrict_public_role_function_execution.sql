-- Follow-up for databases where the broader `public` role still had EXECUTE.
-- This prevents anon/authenticated users from inheriting RPC access to internal functions.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.resolve_task_flow() from public, anon, authenticated;
revoke execute on function public.resolve_external_event() from public, anon, authenticated;
revoke execute on function public.evaluate_task_dependencies(uuid) from public, anon, authenticated;
revoke execute on function public.orbit_task_activity() from public, anon, authenticated;
revoke execute on function public.orbit_recreate_recurring_task() from public, anon, authenticated;
revoke execute on function public.orbit_comment_activity() from public, anon, authenticated;
revoke execute on function public.process_scheduled_activations() from public, anon, authenticated;
revoke execute on function public.orbit_task_created_activity() from public, anon, authenticated;

-- Supabase advisor reported this helper in the public schema even though Orbit does not use it.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
