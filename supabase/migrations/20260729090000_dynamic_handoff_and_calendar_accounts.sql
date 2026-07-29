-- Dynamically expose only real, active and handoff-enabled accounts as task
-- follow-up choices. Existing Derek_msc remains intact but is not offered as
-- a handoff target. Profiles created for future real users default to enabled.

alter table public.user_profiles
  add column if not exists handoff_enabled boolean not null default true;

create or replace function private.enforce_profile_update_permission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then
    if current_user = 'postgres'
      and new.user_id = old.user_id
      and (to_jsonb(new) - array['is_admin','personal_calendar_email','handoff_enabled','updated_at'])
        = (to_jsonb(old) - array['is_admin','personal_calendar_email','handoff_enabled','updated_at'])
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

update public.user_profiles profile
set personal_calendar_email = 'derekcy0309@gmail.com'
from auth.users account
where account.id = profile.user_id
  and lower(account.email) in ('kwok_cy@wecarenursing.com.hk', 'derek_msc@hotmail.com', 'derekcy0309@gmail.com');

update public.user_profiles profile
set handoff_enabled = false
from auth.users account
where account.id = profile.user_id
  and lower(account.email) = 'derek_msc@hotmail.com';

update public.user_profiles profile
set personal_calendar_email = 'love29suki@gmail.com'
from auth.users account
where account.id = profile.user_id
  and lower(account.email) = 'love29suki@gmail.com';

create or replace function public.participant_profiles()
returns table(user_id uuid, display_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select profile.user_id, profile.display_name
  from public.user_profiles profile
  where (select auth.uid()) is not null
    and profile.active
    and profile.handoff_enabled
  order by lower(profile.display_name), profile.user_id;
$$;

revoke all on function public.participant_profiles() from public, anon;
grant execute on function public.participant_profiles() to authenticated;
