-- Restore the strict profile trigger. The admin flag is intentionally retained.
create or replace function private.enforce_profile_update_permission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'PROFILE_UPDATE_FORBIDDEN'; end if;
  if actor <> old.user_id then
    if exists (select 1 from public.user_profiles p where p.user_id = actor and p.is_admin and p.active)
      and (to_jsonb(new) - array['must_change_password','updated_at']) = (to_jsonb(old) - array['must_change_password','updated_at'])
    then return new; end if;
    raise exception 'PROFILE_UPDATE_FORBIDDEN';
  end if;
  if new.user_id <> old.user_id or new.is_admin <> old.is_admin then raise exception 'PROFILE_ADMIN_FIELDS_IMMUTABLE'; end if;
  return new;
end;
$$;
revoke all on function private.enforce_profile_update_permission() from public, anon, authenticated;
