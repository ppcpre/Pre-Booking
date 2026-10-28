-- Supabase Auth runs hooks as supabase_auth_admin; it needs to see the public schema
-- to call public.hook_before_user_created. Nobody else may call the hook directly.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
    grant select on public.team_members to supabase_auth_admin;
  end if;
end $$;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
