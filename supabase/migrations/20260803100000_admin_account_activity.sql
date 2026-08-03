-- Admin-only account activity. This is additive and preserves every existing
-- user profile. "last_seen_at" reflects authenticated Portal use, while the
-- server-only Admin API separately reads Supabase Auth's last_sign_in_at.

alter table public.user_profiles
  add column if not exists last_seen_at timestamptz;

create index if not exists user_profiles_last_seen_at_idx
  on public.user_profiles (last_seen_at desc nulls last);

create or replace function public.touch_current_user_last_seen()
returns timestamptz
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  recorded_at timestamptz;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- A five-minute throttle keeps the field useful without turning routine
  -- background reloads into frequent profile writes.
  update public.user_profiles
  set last_seen_at = now()
  where user_id = actor
    and active
    and (last_seen_at is null or last_seen_at < now() - interval '5 minutes')
  returning last_seen_at into recorded_at;

  if recorded_at is null then
    select last_seen_at into recorded_at
    from public.user_profiles
    where user_id = actor;
  end if;
  return recorded_at;
end;
$$;

revoke all on function public.touch_current_user_last_seen() from public, anon;
grant execute on function public.touch_current_user_last_seen() to authenticated;

comment on column public.user_profiles.last_seen_at is
  'Last authenticated Portal activity, throttled to one update per five minutes.';
