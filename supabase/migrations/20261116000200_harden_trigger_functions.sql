-- Pin search_path so the SECURITY DEFINER function can't be hijacked by
-- objects in other schemas. It already uses a fully qualified table name.
alter function public.handle_new_user() set search_path = '';

-- These are trigger / event-trigger functions. Postgres does not check
-- EXECUTE when a trigger fires, so revoking it only closes the
-- /rest/v1/rpc/... endpoints without affecting sign-up or RLS automation.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
