-- Merge the legacy kwok_cy account into derekcy0309 without creating a user.
--
-- This migration intentionally removes the legacy Auth identity only after every
-- public/private foreign-key reference has been reassigned. The two account IDs
-- are resolved by email at execution time so no generated user IDs are embedded.
-- User settings are already identical on the target account; its newer settings
-- and profile are retained, while all records owned by the legacy account move.

do $$
declare
  source_user uuid;
  target_user uuid;
  relation record;
  has_remaining_reference boolean;
begin
  select id
    into source_user
  from auth.users
  where lower(email) = 'kwok_cy@wecarenursing.com.hk';

  select id
    into target_user
  from auth.users
  where lower(email) = 'derekcy0309@gmail.com';

  if source_user is null then
    raise exception 'ACCOUNT_MERGE_SOURCE_NOT_FOUND';
  end if;

  if target_user is null then
    raise exception 'ACCOUNT_MERGE_TARGET_NOT_FOUND';
  end if;

  if source_user = target_user then
    raise exception 'ACCOUNT_MERGE_SAME_ACCOUNT';
  end if;

  if not exists (
    select 1
    from public.user_profiles
    where user_id = target_user
  ) then
    raise exception 'ACCOUNT_MERGE_TARGET_PROFILE_NOT_FOUND';
  end if;

  -- The target profile is the canonical profile. Keep its display name and
  -- settings, but make the requested administrator and Calendar mapping explicit.
  update public.user_profiles
  set is_admin = true,
      handoff_enabled = true,
      personal_calendar_email = 'derekcy0309@gmail.com',
      updated_at = now()
  where user_id = target_user;

  -- This one-off administrator migration changes only account references. The
  -- normal user-facing update guards correctly reject changes to ownership, so
  -- pause user triggers on the affected application tables while retaining all
  -- foreign-key triggers and constraints. The transaction restores them below;
  -- any exception rolls back the trigger state as well as the data change.
  for relation in
    select distinct n.nspname, c.relname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
      and n.nspname in ('public', 'private')
      and not (
        n.nspname = 'public'
        and c.relname in ('user_profiles', 'user_settings')
      )
  loop
    execute format('alter table %I.%I disable trigger user', relation.nspname, relation.relname);
  end loop;

  -- Move every application-owned foreign key to the target. user_profiles and
  -- user_settings each have a one-row target record already, so they are left
  -- for the Auth-user cascade after their equivalent target data is retained.
  for relation in
    select n.nspname, c.relname, a.attname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join unnest(con.conkey) with ordinality as key_column(attnum, ordinality) on true
    join pg_attribute a
      on a.attrelid = c.oid
     and a.attnum = key_column.attnum
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
      and n.nspname in ('public', 'private')
      and not (
        n.nspname = 'public'
        and c.relname in ('user_profiles', 'user_settings')
      )
  loop
    execute format(
      'update %I.%I set %I = $1 where %I = $2',
      relation.nspname,
      relation.relname,
      relation.attname,
      relation.attname
    ) using target_user, source_user;
  end loop;

  -- Reassign any Storage object ownership too. The preflight verifies these
  -- counts before execution; these statements also keep the migration safe if
  -- an object is uploaded between preflight and this transaction.
  update storage.objects
  set owner = target_user
  where owner = source_user;

  update storage.objects
  set owner_id = target_user::text
  where owner_id = source_user::text;

  -- Do not let an overlooked relationship be silently removed by cascade.
  for relation in
    select n.nspname, c.relname, a.attname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join unnest(con.conkey) with ordinality as key_column(attnum, ordinality) on true
    join pg_attribute a
      on a.attrelid = c.oid
     and a.attnum = key_column.attnum
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
      and n.nspname in ('public', 'private')
      and not (
        n.nspname = 'public'
        and c.relname in ('user_profiles', 'user_settings')
      )
  loop
    execute format(
      'select exists (select 1 from %I.%I where %I = $1)',
      relation.nspname,
      relation.relname,
      relation.attname
    ) into has_remaining_reference using source_user;

    if has_remaining_reference then
      raise exception 'ACCOUNT_MERGE_REFERENCE_REMAINS: %.%.%', relation.nspname, relation.relname, relation.attname;
    end if;
  end loop;

  if exists (select 1 from storage.objects where owner = source_user)
     or exists (select 1 from storage.objects where owner_id = source_user::text) then
    raise exception 'ACCOUNT_MERGE_STORAGE_REFERENCE_REMAINS';
  end if;

  for relation in
    select distinct n.nspname, c.relname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
      and n.nspname in ('public', 'private')
      and not (
        n.nspname = 'public'
        and c.relname in ('user_profiles', 'user_settings')
      )
  loop
    execute format('alter table %I.%I enable trigger user', relation.nspname, relation.relname);
  end loop;

  insert into public.activity_logs (resource_type, resource_id, actor_id, action, summary)
  values (
    'account',
    target_user,
    target_user,
    'merged_legacy_account',
    'Merged the legacy account into this account and revoked its access.'
  );

  -- Delete sessions first. Supabase JWTs still expire normally, but no refresh
  -- session remains for the legacy account after this transaction.
  delete from auth.sessions
  where user_id = source_user;

  -- This cascades the now-redundant legacy profile, settings and Auth identities.
  delete from auth.users
  where id = source_user;

  if exists (
    select 1
    from auth.users
    where lower(email) = 'kwok_cy@wecarenursing.com.hk'
  ) then
    raise exception 'ACCOUNT_MERGE_SOURCE_DELETE_FAILED';
  end if;
end;
$$;
