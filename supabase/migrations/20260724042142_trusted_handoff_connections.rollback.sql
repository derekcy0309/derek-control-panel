create or replace function public.participant_profiles()
returns table(user_id uuid, display_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct p.user_id, p.display_name
  from public.user_profiles p
  where (select auth.uid()) is not null and (
    p.user_id = (select auth.uid())
    or exists (
      select 1 from public.share_records s
      where s.revoked_at is null and
        ((s.owner_id = (select auth.uid()) and s.shared_with_user_id = p.user_id)
          or (s.shared_with_user_id = (select auth.uid()) and s.owner_id = p.user_id))
    )
    or exists (
      select 1 from public.assignments a
      where (a.assigned_by_id = (select auth.uid()) and a.assigned_to_id = p.user_id)
         or (a.assigned_to_id = (select auth.uid()) and a.assigned_by_id = p.user_id)
    )
  );
$$;
revoke all on function public.participant_profiles() from public, anon;
grant execute on function public.participant_profiles() to authenticated;

drop table if exists public.user_handoff_connections;
