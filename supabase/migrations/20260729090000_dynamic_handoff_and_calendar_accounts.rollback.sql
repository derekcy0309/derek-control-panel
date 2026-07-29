-- Restore the previous trusted-connection participant selection rule.
-- This does not delete users, tasks, assignments, shares or Calendar data.

create or replace function private.enforce_profile_update_permission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then
    if current_user = 'postgres'
      and new.user_id = old.user_id
      and (to_jsonb(new) - array['is_admin','personal_calendar_email','updated_at'])
        = (to_jsonb(old) - array['is_admin','personal_calendar_email','updated_at'])
    then return new; end if;
    raise exception 'PROFILE_UPDATE_FORBIDDEN';
  end if;
  if actor <> old.user_id then
    if exists (select 1 from public.user_profiles profile where profile.user_id = actor and profile.is_admin and profile.active)
      and (to_jsonb(new) - array['must_change_password','updated_at'])
        = (to_jsonb(old) - array['must_change_password','updated_at'])
    then return new; end if;
    raise exception 'PROFILE_UPDATE_FORBIDDEN';
  end if;
  if new.user_id <> old.user_id or new.is_admin <> old.is_admin then
    raise exception 'PROFILE_ADMIN_FIELDS_IMMUTABLE';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_profile_update_permission() from public, anon, authenticated;

create or replace function public.participant_profiles()
returns table(user_id uuid, display_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct profile.user_id, profile.display_name
  from public.user_profiles profile
  where (select auth.uid()) is not null
    and profile.active
    and (
      profile.user_id = (select auth.uid())
      or exists (
        select 1 from public.user_handoff_connections connection
        where connection.user_id = (select auth.uid())
          and connection.participant_user_id = profile.user_id
      )
      or exists (
        select 1 from public.share_records share
        where share.revoked_at is null and
          ((share.owner_id = (select auth.uid()) and share.shared_with_user_id = profile.user_id)
            or (share.shared_with_user_id = (select auth.uid()) and share.owner_id = profile.user_id))
      )
      or exists (
        select 1 from public.assignments assignment
        where (assignment.assigned_by_id = (select auth.uid()) and assignment.assigned_to_id = profile.user_id)
           or (assignment.assigned_to_id = (select auth.uid()) and assignment.assigned_by_id = profile.user_id)
      )
    );
$$;

revoke all on function public.participant_profiles() from public, anon;
grant execute on function public.participant_profiles() to authenticated;

alter table public.user_profiles
  drop column if exists handoff_enabled;
