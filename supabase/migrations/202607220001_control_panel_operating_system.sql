-- Derek Control Panel privacy-first operating system upgrade.
-- Additive migration: existing tasks, transactions, meetings and balances are preserved.
-- Backup before production: create a Supabase PITR/manual backup and export public schema.

create extension if not exists "pgcrypto";
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Harden legacy helper functions reported by Supabase's security advisor.
alter function public.set_updated_at() set search_path = public, pg_temp;
revoke all on function public.set_updated_at() from public, anon, authenticated;
alter function public.purge_deleted_tasks_older_than_30_days() set search_path = public, pg_temp;
revoke all on function public.purge_deleted_tasks_older_than_30_days() from public, anon, authenticated;
grant execute on function public.purge_deleted_tasks_older_than_30_days() to service_role;

-- Shared enums are text + CHECK constraints to keep this migration easy to roll forward.
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  timezone text not null default 'Asia/Hong_Kong',
  active boolean not null default true,
  is_admin boolean not null default false,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings
  add column if not exists theme text not null default 'system',
  add column if not exists language text not null default 'zh-HK',
  add column if not exists accent_colour text not null default 'indigo',
  add column if not exists gentle_mode boolean not null default false,
  add column if not exists low_capacity_mode boolean not null default false,
  add column if not exists dashboard_density text not null default 'comfortable',
  add column if not exists wip_limit integer not null default 3,
  add column if not exists quiet_hours_start time default '22:00',
  add column if not exists quiet_hours_end time default '08:00',
  add column if not exists notification_mode text not null default 'daily_summary',
  add column if not exists default_area text not null default 'personal',
  add column if not exists focus_minutes integer not null default 25,
  add column if not exists monthly_profit_target numeric(12,2) not null default 50000,
  add column if not exists pinned_pages text[] not null default '{}';

alter table public.user_settings drop constraint if exists user_settings_theme_check;
alter table public.user_settings add constraint user_settings_theme_check check (theme in ('light','dark','system'));
alter table public.user_settings drop constraint if exists user_settings_density_check;
alter table public.user_settings add constraint user_settings_density_check check (dashboard_density in ('calm','comfortable','compact'));
alter table public.user_settings drop constraint if exists user_settings_wip_limit_check;
alter table public.user_settings add constraint user_settings_wip_limit_check check (wip_limit between 1 and 12);

alter table public.tasks
  add column if not exists owner_id uuid references auth.users(id),
  add column if not exists created_by_id uuid references auth.users(id),
  add column if not exists visibility text not null default 'private',
  add column if not exists area text not null default 'personal',
  add column if not exists description text,
  add column if not exists assignee_id uuid references auth.users(id),
  add column if not exists requested_priority integer not null default 3,
  add column if not exists planned_date date,
  add column if not exists estimated_minutes integer,
  add column if not exists actual_minutes integer,
  add column if not exists energy_level text,
  add column if not exists context text,
  add column if not exists definition_of_done text,
  add column if not exists required_information text,
  add column if not exists blocked_reason text,
  add column if not exists critical_path boolean not null default false,
  add column if not exists revenue_impact numeric(12,2),
  add column if not exists safety_impact boolean not null default false,
  add column if not exists child_impact boolean not null default false,
  add column if not exists legal_impact boolean not null default false,
  add column if not exists last_progress_at timestamptz,
  add column if not exists snoozed_until timestamptz,
  add column if not exists estimated_duration_days integer,
  add column if not exists buffer_days integer not null default 0,
  add column if not exists latest_safe_start_date date,
  add column if not exists progress integer not null default 0;

update public.tasks
set owner_id = user_id,
    created_by_id = user_id,
    area = case scope when 'company' then 'work' else 'family' end,
    visibility = 'private',
    last_progress_at = coalesce(last_progress_at, updated_at)
where owner_id is null or created_by_id is null;

alter table public.tasks alter column owner_id set not null;
alter table public.tasks alter column created_by_id set not null;
alter table public.tasks drop constraint if exists tasks_visibility_check;
alter table public.tasks add constraint tasks_visibility_check check (visibility in ('private','shared','assigned','joint'));
alter table public.tasks drop constraint if exists tasks_area_check;
alter table public.tasks add constraint tasks_area_check check (area in ('work','family','personal'));
alter table public.tasks drop constraint if exists tasks_progress_check;
alter table public.tasks add constraint tasks_progress_check check (progress between 0 and 100);
alter table public.tasks drop constraint if exists tasks_priority_check;
alter table public.tasks add constraint tasks_priority_check check (requested_priority between 1 and 5);

create table if not exists public.share_records (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  resource_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  shared_with_user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null default 'view',
  share_type text not null default 'reference',
  include_attachments boolean not null default false,
  include_comments boolean not null default false,
  include_linked_documents boolean not null default false,
  include_subtasks boolean not null default false,
  include_future_items boolean not null default false,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  constraint share_records_permission_check check (permission in ('view','comment','update_status','edit','co_owner')),
  constraint share_records_type_check check (share_type in ('reference','assignment','joint')),
  constraint share_records_not_self check (owner_id <> shared_with_user_id)
);
create unique index if not exists share_records_active_unique
  on public.share_records(resource_type, resource_id, shared_with_user_id)
  where revoked_at is null;

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  resource_id uuid not null,
  assigned_by_id uuid not null references auth.users(id) on delete cascade,
  assigned_to_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending_acceptance',
  due_date date,
  requested_priority integer not null default 3,
  definition_of_done text,
  instructions text,
  decline_reason text,
  proposed_date date,
  clarification_request text,
  accepted_at timestamptz,
  declined_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignments_status_check check (status in (
    'pending_acceptance','accepted','declined','clarification_requested',
    'alternative_date_proposed','in_progress','blocked','completed','cancelled'
  )),
  constraint assignments_priority_check check (requested_priority between 1 and 5),
  constraint assignments_not_self check (assigned_by_id <> assigned_to_id)
);
create unique index if not exists assignments_active_unique
  on public.assignments(resource_type, resource_id, assigned_to_id)
  where status not in ('declined','completed','cancelled');

create table if not exists public.joint_memberships (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  resource_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'co_owner',
  invited_by_id uuid not null references auth.users(id) on delete cascade,
  accepted_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint joint_memberships_role_check check (role in ('co_owner','editor'))
);
create unique index if not exists joint_memberships_active_unique
  on public.joint_memberships(resource_type, resource_id, user_id)
  where removed_at is null;

create table if not exists public.user_planning_metadata (
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_type text not null,
  resource_id uuid not null,
  personal_priority integer not null default 3,
  planned_date date,
  snoozed_until timestamptz,
  pinned boolean not null default false,
  hidden_from_today boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, resource_type, resource_id),
  constraint user_planning_priority_check check (personal_priority between 1 and 5)
);

create table if not exists public.share_audit_logs (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  resource_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  previous_permission text,
  new_permission text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  resource_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.operating_items (
  id uuid primary key default gen_random_uuid(),
  item_type text not null,
  title text not null,
  description text,
  status text not null default 'active',
  area text not null default 'personal',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_by_id uuid not null references auth.users(id) on delete cascade,
  assignee_id uuid references auth.users(id) on delete set null,
  visibility text not null default 'private',
  due_date date,
  next_action text,
  sensitive boolean not null default false,
  metadata jsonb not null default '{}',
  last_progress_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operating_items_area_check check (area in ('work','family','personal')),
  constraint operating_items_visibility_check check (visibility in ('private','shared','assigned','joint')),
  constraint operating_items_status_check check (status in ('inbox','active','waiting','blocked','review','completed','cancelled'))
);

create table if not exists public.daily_capacity_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkin_date date not null default current_date,
  energy_level text not null,
  available_minutes integer,
  mode text not null default 'normal',
  essential_only boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, checkin_date),
  constraint capacity_energy_check check (energy_level in ('low','medium','high')),
  constraint capacity_mode_check check (mode in ('normal','gentle','minimum_step','shift'))
);

create index if not exists tasks_owner_area_status_idx on public.tasks(owner_id, area, status);
create index if not exists tasks_assignee_status_idx on public.tasks(assignee_id, status);
create index if not exists share_records_recipient_idx on public.share_records(shared_with_user_id, revoked_at);
create index if not exists assignments_recipient_status_idx on public.assignments(assigned_to_id, status);
create index if not exists operating_items_owner_type_idx on public.operating_items(owner_id, item_type, status);
create index if not exists operating_items_due_idx on public.operating_items(owner_id, due_date);
create index if not exists activity_logs_resource_idx on public.activity_logs(resource_type, resource_id, created_at desc);

-- Keep legacy user_id and the new owner fields in sync for backwards compatibility.
create or replace function private.prepare_task_identity()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  new.owner_id := coalesce(new.owner_id, new.user_id, (select auth.uid()));
  new.user_id := new.owner_id;
  new.created_by_id := coalesce(new.created_by_id, (select auth.uid()), new.owner_id);
  if new.status in ('in_progress') and nullif(btrim(new.next_action), '') is null then
    raise exception 'NEXT_ACTION_REQUIRED';
  end if;
  if new.due_date is not null and new.estimated_duration_days is not null then
    new.latest_safe_start_date := new.due_date - (new.estimated_duration_days + coalesce(new.buffer_days, 0));
  end if;
  return new;
end;
$$;
drop trigger if exists prepare_task_identity_trigger on public.tasks;
create trigger prepare_task_identity_trigger before insert or update on public.tasks
for each row execute function private.prepare_task_identity();
revoke all on function private.prepare_task_identity() from public, anon, authenticated;

create or replace function private.current_user_can_read(p_resource_type text, p_resource_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select (select auth.uid()) is not null and (
    exists (select 1 from public.tasks t where p_resource_type = 'task' and t.id = p_resource_id and t.owner_id = (select auth.uid()))
    or exists (select 1 from public.operating_items i where p_resource_type = 'operating_item' and i.id = p_resource_id and i.owner_id = (select auth.uid()))
    or exists (
      select 1 from public.share_records s
      where s.resource_type = p_resource_type and s.resource_id = p_resource_id
        and s.shared_with_user_id = (select auth.uid()) and s.revoked_at is null
        and (s.expires_at is null or s.expires_at > now())
    )
    or exists (
      select 1 from public.assignments a
      where a.resource_type = p_resource_type and a.resource_id = p_resource_id
        and a.assigned_to_id = (select auth.uid())
        and a.status in ('accepted','in_progress','blocked','completed')
    )
    or exists (
      select 1 from public.joint_memberships j
      where j.resource_type = p_resource_type and j.resource_id = p_resource_id
        and j.user_id = (select auth.uid()) and j.accepted_at is not null and j.removed_at is null
    )
  );
$$;
revoke all on function private.current_user_can_read(text, uuid) from public;
grant execute on function private.current_user_can_read(text, uuid) to authenticated;

create or replace function private.enforce_task_update_permission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := (select auth.uid());
  allowed_permission text;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if actor = old.owner_id then return new; end if;
  select s.permission into allowed_permission
  from public.share_records s
  where s.resource_type = 'task' and s.resource_id = old.id
    and s.shared_with_user_id = actor and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
  order by s.created_at desc limit 1;
  if allowed_permission is null and exists (
    select 1 from public.assignments a where a.resource_type = 'task' and a.resource_id = old.id
      and a.assigned_to_id = actor and a.status in ('accepted','in_progress','blocked')
  ) then allowed_permission := 'update_status'; end if;
  if allowed_permission = 'co_owner' and exists (
    select 1 from public.joint_memberships j where j.resource_type = 'task' and j.resource_id = old.id
      and j.user_id = actor and j.accepted_at is not null and j.removed_at is null
  ) then return new; end if;
  if allowed_permission = 'edit' then
    if new.owner_id <> old.owner_id or new.user_id <> old.user_id or new.created_by_id <> old.created_by_id
       or new.visibility <> old.visibility then raise exception 'OWNER_FIELDS_IMMUTABLE'; end if;
    return new;
  end if;
  if allowed_permission = 'update_status' and
     (new.assignee_id is not distinct from old.assignee_id or new.assignee_id = actor) and
     (to_jsonb(new) - array['status','progress','blocked_reason','completed_at','last_progress_at','actual_minutes','updated_at','assignee_id']) =
     (to_jsonb(old) - array['status','progress','blocked_reason','completed_at','last_progress_at','actual_minutes','updated_at','assignee_id'])
  then return new; end if;
  raise exception 'TASK_UPDATE_FORBIDDEN';
end;
$$;
drop trigger if exists enforce_task_update_permission_trigger on public.tasks;
create trigger enforce_task_update_permission_trigger before update on public.tasks
for each row execute function private.enforce_task_update_permission();
revoke all on function private.enforce_task_update_permission() from public, anon, authenticated;

create or replace function private.enforce_operating_item_update_permission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := (select auth.uid());
  allowed_permission text;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if actor = old.owner_id then return new; end if;
  select s.permission into allowed_permission
  from public.share_records s
  where s.resource_type = 'operating_item' and s.resource_id = old.id
    and s.shared_with_user_id = actor and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
  order by s.created_at desc limit 1;
  if allowed_permission = 'co_owner' and exists (
    select 1 from public.joint_memberships j where j.resource_type = 'operating_item' and j.resource_id = old.id
      and j.user_id = actor and j.accepted_at is not null and j.removed_at is null
  ) then
    if new.owner_id <> old.owner_id or new.created_by_id <> old.created_by_id or new.visibility <> old.visibility
    then raise exception 'OWNER_FIELDS_IMMUTABLE'; end if;
    return new;
  end if;
  if allowed_permission = 'edit' then
    if new.owner_id <> old.owner_id or new.created_by_id <> old.created_by_id or new.visibility <> old.visibility
    then raise exception 'OWNER_FIELDS_IMMUTABLE'; end if;
    return new;
  end if;
  if exists (
    select 1 from public.assignments a where a.resource_type = 'operating_item' and a.resource_id = old.id
      and a.assigned_to_id = actor and a.status in ('accepted','in_progress','blocked')
  ) and (new.assignee_id is not distinct from old.assignee_id or new.assignee_id = actor)
    and (to_jsonb(new) - array['status','last_progress_at','updated_at','assignee_id']) =
        (to_jsonb(old) - array['status','last_progress_at','updated_at','assignee_id'])
  then return new; end if;
  raise exception 'OPERATING_ITEM_UPDATE_FORBIDDEN';
end;
$$;
drop trigger if exists enforce_operating_item_update_permission_trigger on public.operating_items;
create trigger enforce_operating_item_update_permission_trigger before update on public.operating_items
for each row execute function private.enforce_operating_item_update_permission();
revoke all on function private.enforce_operating_item_update_permission() from public, anon, authenticated;

create or replace function private.enforce_share_record_update_permission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select auth.uid()) is null or (select auth.uid()) <> old.owner_id then raise exception 'SHARE_UPDATE_FORBIDDEN'; end if;
  if new.resource_type <> old.resource_type or new.resource_id <> old.resource_id
     or new.owner_id <> old.owner_id or new.shared_with_user_id <> old.shared_with_user_id
     or new.share_type <> old.share_type
  then raise exception 'SHARE_IDENTITY_IMMUTABLE'; end if;
  return new;
end;
$$;
drop trigger if exists enforce_share_record_update_permission_trigger on public.share_records;
create trigger enforce_share_record_update_permission_trigger before update on public.share_records
for each row execute function private.enforce_share_record_update_permission();
revoke all on function private.enforce_share_record_update_permission() from public, anon, authenticated;

create or replace function private.enforce_assignment_update_permission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if new.resource_type <> old.resource_type or new.resource_id <> old.resource_id
     or new.assigned_by_id <> old.assigned_by_id or new.assigned_to_id <> old.assigned_to_id
  then raise exception 'ASSIGNMENT_IDENTITY_IMMUTABLE'; end if;
  if actor = old.assigned_by_id then return new; end if;
  if actor = old.assigned_to_id
    and new.status in ('accepted','declined','clarification_requested','alternative_date_proposed','in_progress','blocked','completed')
    and (to_jsonb(new) - array['status','decline_reason','proposed_date','clarification_request','accepted_at','declined_at','completed_at','updated_at']) =
        (to_jsonb(old) - array['status','decline_reason','proposed_date','clarification_request','accepted_at','declined_at','completed_at','updated_at'])
  then return new; end if;
  raise exception 'ASSIGNMENT_UPDATE_FORBIDDEN';
end;
$$;
drop trigger if exists enforce_assignment_update_permission_trigger on public.assignments;
create trigger enforce_assignment_update_permission_trigger before update on public.assignments
for each row execute function private.enforce_assignment_update_permission();
revoke all on function private.enforce_assignment_update_permission() from public, anon, authenticated;

create or replace function private.enforce_joint_update_permission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if new.resource_type <> old.resource_type or new.resource_id <> old.resource_id
     or new.user_id <> old.user_id or new.invited_by_id <> old.invited_by_id
  then raise exception 'JOINT_IDENTITY_IMMUTABLE'; end if;
  if actor = old.user_id
    and (to_jsonb(new) - array['accepted_at']) = (to_jsonb(old) - array['accepted_at'])
  then return new; end if;
  if actor = old.invited_by_id
    and (to_jsonb(new) - array['role','removed_at']) = (to_jsonb(old) - array['role','removed_at'])
  then return new; end if;
  raise exception 'JOINT_UPDATE_FORBIDDEN';
end;
$$;
drop trigger if exists enforce_joint_update_permission_trigger on public.joint_memberships;
create trigger enforce_joint_update_permission_trigger before update on public.joint_memberships
for each row execute function private.enforce_joint_update_permission();
revoke all on function private.enforce_joint_update_permission() from public, anon, authenticated;

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
drop trigger if exists enforce_profile_update_permission_trigger on public.user_profiles;
create trigger enforce_profile_update_permission_trigger before update on public.user_profiles
for each row execute function private.enforce_profile_update_permission();
revoke all on function private.enforce_profile_update_permission() from public, anon, authenticated;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inferred_name text;
begin
  inferred_name := coalesce(nullif(new.raw_user_meta_data->>'display_name',''), nullif(new.raw_user_meta_data->>'full_name',''), initcap(split_part(new.email,'@',1)), 'User');
  insert into public.user_profiles(user_id, display_name) values (new.id, inferred_name) on conflict (user_id) do nothing;
  insert into public.user_settings(user_id, email, gentle_mode, dashboard_density)
  values (new.id, new.email, lower(inferred_name) = 'suki', case when lower(inferred_name) = 'suki' then 'calm' else 'comfortable' end)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_control_panel on auth.users;
create trigger on_auth_user_created_control_panel after insert on auth.users
for each row execute function private.handle_new_user();
revoke all on function private.handle_new_user() from public, anon, authenticated;

insert into public.user_profiles(user_id, display_name)
select id, coalesce(nullif(raw_user_meta_data->>'display_name',''), nullif(raw_user_meta_data->>'full_name',''), initcap(split_part(email,'@',1)), 'User')
from auth.users on conflict (user_id) do nothing;

create or replace function public.resolve_share_target(target_email text)
returns table(user_id uuid, display_name text)
language sql stable security definer set search_path = public, auth, pg_temp as $$
  select u.id, p.display_name
  from auth.users u join public.user_profiles p on p.user_id = u.id
  where (select auth.uid()) is not null
    and lower(u.email) = lower(btrim(target_email))
    and u.id <> (select auth.uid()) and p.active
  limit 1;
$$;
revoke all on function public.resolve_share_target(text) from public, anon;
grant execute on function public.resolve_share_target(text) to authenticated;

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

create or replace function public.admin_prepare_password_reset(target_email text)
returns uuid
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare target_user_id uuid;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.user_profiles p where p.user_id = (select auth.uid()) and p.is_admin and p.active
  ) then raise exception 'ADMIN_REQUIRED'; end if;
  select u.id into target_user_id
  from auth.users u join public.user_profiles p on p.user_id = u.id
  where lower(u.email) = lower(btrim(target_email)) and p.active
  limit 1;
  if target_user_id is null then raise exception 'TARGET_NOT_FOUND'; end if;
  update public.user_profiles set must_change_password = true where user_id = target_user_id;
  insert into public.share_audit_logs(resource_type, resource_id, actor_id, target_user_id, action)
  values ('account', target_user_id, (select auth.uid()), target_user_id, 'password_reset_requested');
  return target_user_id;
end;
$$;
revoke all on function public.admin_prepare_password_reset(text) from public, anon;
grant execute on function public.admin_prepare_password_reset(text) to authenticated;

-- RLS: private by default; shares/assignments/joint membership are explicit capabilities.
alter table public.user_profiles enable row level security;
alter table public.share_records enable row level security;
alter table public.assignments enable row level security;
alter table public.joint_memberships enable row level security;
alter table public.user_planning_metadata enable row level security;
alter table public.share_audit_logs enable row level security;
alter table public.activity_logs enable row level security;
alter table public.operating_items enable row level security;
alter table public.daily_capacity_checkins enable row level security;

drop policy if exists profiles_select_own on public.user_profiles;
create policy profiles_select_own on public.user_profiles for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists profiles_insert_own on public.user_profiles;
create policy profiles_insert_own on public.user_profiles for insert to authenticated with check ((select auth.uid()) = user_id and not is_admin);
drop policy if exists profiles_update_own on public.user_profiles;
create policy profiles_update_own on public.user_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists tasks_select_own on public.tasks;
drop policy if exists tasks_insert_own on public.tasks;
drop policy if exists tasks_update_own on public.tasks;
drop policy if exists tasks_delete_own on public.tasks;
create policy tasks_select_authorized on public.tasks for select to authenticated
using (owner_id = (select auth.uid()) or (select private.current_user_can_read('task', id)));
create policy tasks_insert_owner on public.tasks for insert to authenticated
with check (owner_id = (select auth.uid()) and created_by_id = (select auth.uid()) and user_id = (select auth.uid()));
create policy tasks_update_authorized on public.tasks for update to authenticated
using (owner_id = (select auth.uid()) or (select private.current_user_can_read('task', id)))
with check (owner_id is not null);
create policy tasks_delete_owner on public.tasks for delete to authenticated using (owner_id = (select auth.uid()));

create policy share_records_select_participant on public.share_records for select to authenticated
using (owner_id = (select auth.uid()) or shared_with_user_id = (select auth.uid()));
create policy share_records_insert_owner on public.share_records for insert to authenticated
with check (owner_id = (select auth.uid()) and owner_id <> shared_with_user_id);
create policy share_records_update_owner on public.share_records for update to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy share_records_delete_owner on public.share_records for delete to authenticated using (owner_id = (select auth.uid()));

create policy assignments_select_participant on public.assignments for select to authenticated
using (assigned_by_id = (select auth.uid()) or assigned_to_id = (select auth.uid()));
create policy assignments_insert_assigner on public.assignments for insert to authenticated
with check (assigned_by_id = (select auth.uid()) and assigned_by_id <> assigned_to_id);
create policy assignments_update_participant on public.assignments for update to authenticated
using (assigned_by_id = (select auth.uid()) or assigned_to_id = (select auth.uid()))
with check (assigned_by_id is not null and assigned_to_id is not null);

create policy joint_memberships_select_participant on public.joint_memberships for select to authenticated
using (user_id = (select auth.uid()) or invited_by_id = (select auth.uid()));
create policy joint_memberships_insert_inviter on public.joint_memberships for insert to authenticated
with check (invited_by_id = (select auth.uid()));
create policy joint_memberships_update_participant on public.joint_memberships for update to authenticated
using (user_id = (select auth.uid()) or invited_by_id = (select auth.uid()));

create policy planning_metadata_own on public.user_planning_metadata for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy share_audit_select_actor_or_target on public.share_audit_logs for select to authenticated
using (actor_id = (select auth.uid()) or target_user_id = (select auth.uid()));
create policy share_audit_insert_actor on public.share_audit_logs for insert to authenticated
with check (actor_id = (select auth.uid()));

create policy activity_select_authorized on public.activity_logs for select to authenticated
using (actor_id = (select auth.uid()) or (select private.current_user_can_read(resource_type, resource_id)));
create policy activity_insert_actor on public.activity_logs for insert to authenticated
with check (actor_id = (select auth.uid()) and (select private.current_user_can_read(resource_type, resource_id)));

create policy operating_items_select_authorized on public.operating_items for select to authenticated
using (owner_id = (select auth.uid()) or (select private.current_user_can_read('operating_item', id)));
create policy operating_items_insert_owner on public.operating_items for insert to authenticated
with check (owner_id = (select auth.uid()) and created_by_id = (select auth.uid()) and visibility = 'private');
create policy operating_items_update_authorized on public.operating_items for update to authenticated
using (owner_id = (select auth.uid()) or (select private.current_user_can_read('operating_item', id)))
with check (owner_id is not null);
create policy operating_items_delete_owner on public.operating_items for delete to authenticated
using (owner_id = (select auth.uid()));

create policy capacity_checkins_private on public.daily_capacity_checkins for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Existing private tables remain owner-only; make role targeting and init plans explicit.
do $$
declare t text;
begin
  foreach t in array array['transactions','meetings','balances','user_settings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_delete_own', t);
  end loop;
end $$;

revoke all on public.tasks, public.transactions, public.meetings, public.balances, public.user_settings,
  public.user_profiles, public.share_records, public.assignments, public.joint_memberships,
  public.user_planning_metadata, public.share_audit_logs, public.activity_logs,
  public.operating_items, public.daily_capacity_checkins from anon;
grant select, insert, update, delete on public.tasks, public.transactions, public.meetings,
  public.balances, public.user_settings to authenticated;
grant select, insert, update, delete on public.user_profiles, public.share_records, public.assignments,
  public.joint_memberships, public.user_planning_metadata, public.share_audit_logs,
  public.activity_logs, public.operating_items, public.daily_capacity_checkins to authenticated;

-- Notification previews must stay generic. This function never returns resource titles or notes.
create or replace function public.notification_preview(notification_kind text, actor_name text default null)
returns text language sql immutable security invoker as $$
  select case notification_kind
    when 'assignment' then coalesce(actor_name, '對方') || ' 指派了一項工作給你'
    when 'family' then '你有一項家庭事項需要處理'
    when 'document' then '一項私人文件即將到期'
    when 'health' then '你今日有一項健康行政事項'
    else '你有一項事項需要留意'
  end;
$$;
grant execute on function public.notification_preview(text, text) to authenticated;
