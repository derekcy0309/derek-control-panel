-- Derek Control Panel v1.0: household privacy, confirmed schedules,
-- private AI plans and gentle three-day email reminders.
-- Additive migration. Existing private records remain private until their owner
-- explicitly creates/accepts a household.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Household access: membership alone never exposes private/work data.
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default '家庭',
  created_by_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  invited_by_id uuid not null references auth.users(id) on delete restrict,
  role text not null default 'member',
  status text not null default 'invited',
  accepted_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id),
  constraint household_members_role_check check (role in ('owner','member')),
  constraint household_members_status_check check (status in ('invited','accepted','declined'))
);

create unique index if not exists household_members_one_active_household_idx
  on public.household_members(user_id)
  where status in ('invited','accepted');
create index if not exists household_members_household_status_idx
  on public.household_members(household_id, status, user_id);
create index if not exists households_created_by_idx
  on public.households(created_by_id);

alter table public.tasks add column if not exists household_id uuid references public.households(id) on delete set null;
alter table public.operating_items add column if not exists household_id uuid references public.households(id) on delete set null;

alter table public.tasks drop constraint if exists tasks_visibility_check;
alter table public.tasks add constraint tasks_visibility_check
  check (visibility in ('private','household','shared','assigned','joint'));
alter table public.operating_items drop constraint if exists operating_items_visibility_check;
alter table public.operating_items add constraint operating_items_visibility_check
  check (visibility in ('private','household','shared','assigned','joint'));

alter table public.tasks drop constraint if exists tasks_household_visibility_check;
alter table public.tasks add constraint tasks_household_visibility_check check (
  (visibility = 'household' and area = 'family' and household_id is not null)
  or (visibility <> 'household' and household_id is null)
);
alter table public.operating_items drop constraint if exists operating_items_household_visibility_check;
alter table public.operating_items add constraint operating_items_household_visibility_check check (
  (visibility = 'household' and area = 'family' and household_id is not null)
  or (visibility <> 'household' and household_id is null)
);

create index if not exists tasks_household_area_status_idx
  on public.tasks(household_id, area, status)
  where visibility = 'household' and deleted_at is null and archived_at is null;
create index if not exists operating_items_household_due_idx
  on public.operating_items(household_id, due_date)
  where visibility = 'household' and archived_at is null;

create or replace function private.apply_family_visibility()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare linked_household uuid;
begin
  if new.area <> 'family' then
    if new.visibility = 'household' then new.visibility := 'private'; end if;
    new.household_id := null;
    return new;
  end if;
  if new.visibility = 'private' and new.household_id is null then
    select member.household_id into linked_household
    from public.household_members member
    where member.user_id = new.owner_id and member.status = 'accepted'
    limit 1;
    if linked_household is not null then
      new.visibility := 'household';
      new.household_id := linked_household;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.apply_family_visibility() from public, anon, authenticated;
drop trigger if exists apply_family_visibility_tasks_trigger on public.tasks;
create trigger apply_family_visibility_tasks_trigger
before insert or update of area, visibility, household_id on public.tasks
for each row execute function private.apply_family_visibility();
drop trigger if exists apply_family_visibility_items_trigger on public.operating_items;
create trigger apply_family_visibility_items_trigger
before insert or update of area, visibility, household_id on public.operating_items
for each row execute function private.apply_family_visibility();

create or replace function private.current_user_is_household_member(p_household_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.household_members member
    where member.household_id = p_household_id
      and member.user_id = (select auth.uid())
      and member.status = 'accepted'
  );
$$;
revoke all on function private.current_user_is_household_member(uuid) from public, anon, authenticated, service_role;
grant execute on function private.current_user_is_household_member(uuid) to authenticated;

create or replace function private.current_user_can_read(p_resource_type text, p_resource_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    exists (
      select 1 from public.tasks task
      where p_resource_type = 'task' and task.id = p_resource_id
        and (
          task.owner_id = (select auth.uid())
          or (
            task.visibility = 'household'
            and task.household_id is not null
            and private.current_user_is_household_member(task.household_id)
          )
        )
    )
    or exists (
      select 1 from public.operating_items item
      where p_resource_type = 'operating_item' and item.id = p_resource_id
        and (
          item.owner_id = (select auth.uid())
          or (
            item.visibility = 'household'
            and item.household_id is not null
            and private.current_user_is_household_member(item.household_id)
          )
        )
    )
    or exists (
      select 1 from public.share_records share
      where share.resource_type = p_resource_type
        and share.resource_id = p_resource_id
        and share.shared_with_user_id = (select auth.uid())
        and share.revoked_at is null
        and (share.expires_at is null or share.expires_at > now())
    )
    or exists (
      select 1 from public.assignments assignment
      where assignment.resource_type = p_resource_type
        and assignment.resource_id = p_resource_id
        and assignment.assigned_to_id = (select auth.uid())
        and assignment.status in ('accepted','in_progress','waiting','blocked','completed')
    )
    or exists (
      select 1 from public.joint_memberships joint
      where joint.resource_type = p_resource_type
        and joint.resource_id = p_resource_id
        and joint.user_id = (select auth.uid())
        and joint.accepted_at is not null
        and joint.removed_at is null
    )
  );
$$;
revoke all on function private.current_user_can_read(text, uuid) from public, anon;
grant execute on function private.current_user_can_read(text, uuid) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;

create policy households_member_select on public.households
  for select to authenticated
  using ((select private.current_user_is_household_member(id)) or created_by_id = (select auth.uid()));
create policy households_creator_insert on public.households
  for insert to authenticated
  with check (created_by_id = (select auth.uid()));
create policy households_creator_update on public.households
  for update to authenticated
  using (created_by_id = (select auth.uid()))
  with check (created_by_id = (select auth.uid()));

create policy household_members_self_select on public.household_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or invited_by_id = (select auth.uid())
    or (select private.current_user_is_household_member(household_id))
  );

drop policy if exists tasks_insert_owner on public.tasks;
create policy tasks_insert_owner on public.tasks
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and created_by_id = (select auth.uid())
    and user_id = (select auth.uid())
    and (
      (visibility = 'private' and household_id is null)
      or (
        visibility = 'household'
        and area = 'family'
        and (select private.current_user_is_household_member(household_id))
      )
    )
  );
drop policy if exists tasks_update_authorized on public.tasks;
create policy tasks_update_authorized on public.tasks
  for update to authenticated
  using (owner_id = (select auth.uid()) or (select private.current_user_can_read('task', id)))
  with check (
    owner_id is not null
    and (
      (visibility <> 'household' and household_id is null)
      or (
        visibility = 'household'
        and area = 'family'
        and (select private.current_user_is_household_member(household_id))
      )
    )
  );

drop policy if exists operating_items_insert_owner on public.operating_items;
create policy operating_items_insert_owner on public.operating_items
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and created_by_id = (select auth.uid())
    and (
      (visibility = 'private' and household_id is null)
      or (
        visibility = 'household'
        and area = 'family'
        and (select private.current_user_is_household_member(household_id))
      )
    )
  );
drop policy if exists operating_items_update_authorized on public.operating_items;
create policy operating_items_update_authorized on public.operating_items
  for update to authenticated
  using (owner_id = (select auth.uid()) or (select private.current_user_can_read('operating_item', id)))
  with check (
    owner_id is not null
    and (
      (visibility <> 'household' and household_id is null)
      or (
        visibility = 'household'
        and area = 'family'
        and (select private.current_user_is_household_member(household_id))
      )
    )
  );

create or replace function public.invite_household_member(target_email text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target uuid;
  household uuid;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select users.id into target
  from auth.users users
  join public.user_profiles profile on profile.user_id = users.id and profile.active
  where lower(users.email) = lower(btrim(target_email))
    and users.id <> actor
  limit 1;
  if target is null then raise exception 'HOUSEHOLD_TARGET_NOT_FOUND'; end if;

  select member.household_id into household
  from public.household_members member
  where member.user_id = actor and member.status = 'accepted'
  limit 1;

  if household is null then
    insert into public.households(created_by_id) values (actor) returning id into household;
    insert into public.household_members(household_id, user_id, invited_by_id, role, status, accepted_at)
    values (household, actor, actor, 'owner', 'accepted', now());
  end if;

  if not exists (
    select 1 from public.household_members member
    where member.household_id = household
      and member.user_id = actor
      and member.role = 'owner'
      and member.status = 'accepted'
  ) then
    raise exception 'HOUSEHOLD_OWNER_REQUIRED';
  end if;

  if exists (
    select 1 from public.household_members member
    where member.household_id = household
      and member.user_id <> actor
      and member.user_id <> target
      and member.status in ('invited','accepted')
  ) then
    raise exception 'HOUSEHOLD_ALREADY_FULL';
  end if;

  if exists (
    select 1 from public.household_members member
    where member.user_id = target
      and member.status in ('invited','accepted')
      and member.household_id <> household
  ) then raise exception 'HOUSEHOLD_TARGET_ALREADY_LINKED'; end if;

  insert into public.household_members(household_id, user_id, invited_by_id, role, status)
  values (household, target, actor, 'member', 'invited')
  on conflict (household_id, user_id) do update
  set status = case when public.household_members.status = 'accepted' then 'accepted' else 'invited' end,
      invited_by_id = actor,
      declined_at = null,
      updated_at = now();

  update public.tasks
  set visibility = 'household', household_id = household
  where owner_id = actor and area = 'family' and visibility = 'private';
  update public.operating_items
  set visibility = 'household', household_id = household
  where owner_id = actor and area = 'family' and visibility = 'private';
  return household;
end;
$$;
revoke all on function public.invite_household_member(text) from public, anon;
grant execute on function public.invite_household_member(text) to authenticated;

create or replace function public.respond_household_invitation(p_household_id uuid, p_accept boolean)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.household_members member
    where member.household_id = p_household_id
      and member.user_id = actor
      and member.status = 'invited'
  ) then raise exception 'HOUSEHOLD_INVITATION_NOT_FOUND'; end if;

  update public.household_members
  set status = case when p_accept then 'accepted' else 'declined' end,
      accepted_at = case when p_accept then now() else null end,
      declined_at = case when p_accept then null else now() end,
      updated_at = now()
  where household_id = p_household_id and user_id = actor;

  if p_accept then
    update public.tasks
    set visibility = 'household', household_id = p_household_id
    where owner_id = actor and area = 'family' and visibility = 'private';
    update public.operating_items
    set visibility = 'household', household_id = p_household_id
    where owner_id = actor and area = 'family' and visibility = 'private';
  end if;
  return p_accept;
end;
$$;
revoke all on function public.respond_household_invitation(uuid, boolean) from public, anon;
grant execute on function public.respond_household_invitation(uuid, boolean) to authenticated;

create or replace function public.household_context()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with mine as (
    select member.household_id, member.status
    from public.household_members member
    where member.user_id = (select auth.uid())
      and member.status in ('invited','accepted')
    limit 1
  )
  select case when not exists (select 1 from mine) then null else jsonb_build_object(
    'householdId', (select household_id from mine),
    'status', (select status from mine),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', member.user_id,
        'displayName', profile.display_name,
        'status', member.status,
        'role', member.role
      ) order by member.created_at)
      from public.household_members member
      join public.user_profiles profile on profile.user_id = member.user_id
      where member.household_id = (select household_id from mine)
    ), '[]'::jsonb)
  ) end;
$$;
revoke all on function public.household_context() from public, anon;
grant execute on function public.household_context() to authenticated;

create or replace function public.participant_profiles()
returns table(user_id uuid, display_name text)
language sql stable security definer
set search_path = ''
as $$
  select distinct profile.user_id, profile.display_name
  from public.user_profiles profile
  where (select auth.uid()) is not null
    and profile.active
    and (
      profile.user_id = (select auth.uid())
      or exists (
        select 1
        from public.household_members mine
        join public.household_members partner on partner.household_id = mine.household_id
        where mine.user_id = (select auth.uid()) and mine.status = 'accepted'
          and partner.user_id = profile.user_id and partner.status = 'accepted'
      )
      or exists (
        select 1 from public.share_records share
        where share.revoked_at is null and (
          (share.owner_id = (select auth.uid()) and share.shared_with_user_id = profile.user_id)
          or (share.shared_with_user_id = (select auth.uid()) and share.owner_id = profile.user_id)
        )
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

-- ---------------------------------------------------------------------------
-- Support profiles and real daily working windows.
-- ---------------------------------------------------------------------------

alter table public.user_settings
  add column if not exists support_profile text not null default 'balanced',
  add column if not exists planning_buffer_percent integer not null default 20,
  add column if not exists default_family_load text not null default 'medium';
alter table public.user_settings drop constraint if exists user_settings_support_profile_check;
alter table public.user_settings add constraint user_settings_support_profile_check
  check (support_profile in ('adhd','depression','balanced'));
alter table public.user_settings drop constraint if exists user_settings_planning_buffer_check;
alter table public.user_settings add constraint user_settings_planning_buffer_check
  check (planning_buffer_percent between 10 and 60);
alter table public.user_settings drop constraint if exists user_settings_family_load_check;
alter table public.user_settings add constraint user_settings_family_load_check
  check (default_family_load in ('low','medium','high'));

update public.user_settings settings
set support_profile = case
  when lower(settings.email) = 'derekcy0309@gmail.com' then 'adhd'
  when lower(profile.display_name) = 'suki' then 'depression'
  else settings.support_profile
end,
gentle_mode = case when lower(profile.display_name) = 'suki' then true else settings.gentle_mode end,
dashboard_density = case when lower(profile.display_name) = 'suki' then 'calm' else settings.dashboard_density end
from public.user_profiles profile
where profile.user_id = settings.user_id;

alter table public.daily_capacity_checkins
  add column if not exists work_windows jsonb not null default '[]'::jsonb,
  add column if not exists family_load text not null default 'medium',
  add column if not exists recovery_need text not null default 'medium',
  add column if not exists buffer_minutes integer not null default 30;
alter table public.daily_capacity_checkins drop constraint if exists capacity_family_load_check;
alter table public.daily_capacity_checkins add constraint capacity_family_load_check
  check (family_load in ('low','medium','high'));
alter table public.daily_capacity_checkins drop constraint if exists capacity_recovery_need_check;
alter table public.daily_capacity_checkins add constraint capacity_recovery_need_check
  check (recovery_need in ('low','medium','high'));
alter table public.daily_capacity_checkins drop constraint if exists capacity_buffer_minutes_check;
alter table public.daily_capacity_checkins add constraint capacity_buffer_minutes_check
  check (buffer_minutes between 0 and 720);
alter table public.daily_capacity_checkins drop constraint if exists capacity_work_windows_array_check;
alter table public.daily_capacity_checkins add constraint capacity_work_windows_array_check
  check (jsonb_typeof(work_windows) = 'array' and jsonb_array_length(work_windows) <= 8);

-- ---------------------------------------------------------------------------
-- Confirmed schedules and encrypted Google Calendar connections.
-- ---------------------------------------------------------------------------

alter table public.operating_items
  add column if not exists schedule_start_at timestamptz,
  add column if not exists schedule_end_at timestamptz,
  add column if not exists schedule_timezone text not null default 'Asia/Hong_Kong',
  add column if not exists schedule_status text,
  add column if not exists calendar_target text not null default 'none';
alter table public.operating_items drop constraint if exists operating_items_schedule_status_check;
alter table public.operating_items add constraint operating_items_schedule_status_check
  check (schedule_status is null or schedule_status in ('tentative','confirmed','cancelled'));
alter table public.operating_items drop constraint if exists operating_items_calendar_target_check;
alter table public.operating_items add constraint operating_items_calendar_target_check
  check (calendar_target in ('none','personal','family','work'));
alter table public.operating_items drop constraint if exists operating_items_schedule_shape_check;
alter table public.operating_items add constraint operating_items_schedule_shape_check check (
  (
    schedule_start_at is null
    and schedule_end_at is null
    and schedule_status is null
    and calendar_target = 'none'
  )
  or (
    item_type = 'event'
    and schedule_status is not null
    and schedule_start_at is not null
    and schedule_end_at is not null
    and schedule_end_at > schedule_start_at
    and (
      schedule_status <> 'confirmed'
      or calendar_target <> 'none'
    )
  )
);
create index if not exists operating_items_confirmed_schedule_idx
  on public.operating_items(owner_id, schedule_start_at)
  where item_type = 'event' and schedule_status = 'confirmed' and archived_at is null;

create table if not exists public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target text not null,
  account_email text not null,
  calendar_id text not null default 'primary',
  calendar_name text not null default 'Primary',
  status text not null default 'connected',
  scopes text[] not null default '{}',
  access_expires_at timestamptz,
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, target),
  constraint google_calendar_connections_target_check check (target in ('personal','family','work')),
  constraint google_calendar_connections_status_check check (status in ('connected','attention','disconnected'))
);

create table if not exists private.google_calendar_tokens (
  connection_id uuid primary key references public.google_calendar_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  updated_at timestamptz not null default now()
);
revoke all on private.google_calendar_tokens from public, anon, authenticated;

create table if not exists public.calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operating_item_id uuid not null references public.operating_items(id) on delete cascade,
  connection_id uuid not null references public.google_calendar_connections(id) on delete cascade,
  google_event_id text not null,
  etag text,
  sync_status text not null default 'pending',
  payload_hash text,
  last_error text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operating_item_id, connection_id),
  constraint calendar_event_links_status_check check (sync_status in ('pending','synced','failed','deleted'))
);
create index if not exists google_calendar_connections_user_status_idx
  on public.google_calendar_connections(user_id, status);
create index if not exists calendar_event_links_user_status_idx
  on public.calendar_event_links(user_id, sync_status);
create index if not exists calendar_event_links_operating_item_idx
  on public.calendar_event_links(operating_item_id);
create index if not exists calendar_event_links_connection_idx
  on public.calendar_event_links(connection_id);

alter table public.google_calendar_connections enable row level security;
alter table public.calendar_event_links enable row level security;
create policy google_calendar_connections_own on public.google_calendar_connections
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy calendar_event_links_own on public.calendar_event_links
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.store_google_calendar_tokens(
  p_connection_id uuid,
  p_access_token_ciphertext text,
  p_refresh_token_ciphertext text
)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null or not exists (
    select 1 from public.google_calendar_connections connection
    where connection.id = p_connection_id and connection.user_id = actor
  ) then raise exception 'CALENDAR_CONNECTION_FORBIDDEN'; end if;
  if nullif(p_access_token_ciphertext, '') is null then raise exception 'CALENDAR_TOKEN_REQUIRED'; end if;
  insert into private.google_calendar_tokens(
    connection_id, user_id, access_token_ciphertext, refresh_token_ciphertext
  ) values (
    p_connection_id, actor, p_access_token_ciphertext, nullif(p_refresh_token_ciphertext, '')
  )
  on conflict (connection_id) do update
  set access_token_ciphertext = excluded.access_token_ciphertext,
      refresh_token_ciphertext = coalesce(excluded.refresh_token_ciphertext, private.google_calendar_tokens.refresh_token_ciphertext),
      updated_at = now();
  return true;
end;
$$;
revoke all on function public.store_google_calendar_tokens(uuid, text, text) from public, anon;
grant execute on function public.store_google_calendar_tokens(uuid, text, text) to authenticated;

create or replace function public.read_google_calendar_tokens(p_connection_id uuid)
returns table(access_token_ciphertext text, refresh_token_ciphertext text)
language sql stable security definer
set search_path = ''
as $$
  select token.access_token_ciphertext, token.refresh_token_ciphertext
  from private.google_calendar_tokens token
  join public.google_calendar_connections connection on connection.id = token.connection_id
  where token.connection_id = p_connection_id
    and connection.user_id = (select auth.uid());
$$;
revoke all on function public.read_google_calendar_tokens(uuid) from public, anon;
grant execute on function public.read_google_calendar_tokens(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Private AI daily planning and task analysis audit.
-- ---------------------------------------------------------------------------

create table if not exists public.ai_daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null,
  status text not null default 'draft',
  energy_level text not null,
  mode text not null default 'normal',
  work_windows jsonb not null,
  buffer_minutes integer not null default 30,
  support_profile text not null default 'balanced',
  model text not null,
  prompt_version text not null,
  summary text,
  source text not null default 'ai',
  accepted_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_daily_plans_status_check check (status in ('draft','accepted','superseded')),
  constraint ai_daily_plans_energy_check check (energy_level in ('low','medium','high')),
  constraint ai_daily_plans_mode_check check (mode in ('normal','gentle','minimum_step','shift')),
  constraint ai_daily_plans_support_check check (support_profile in ('adhd','depression','balanced')),
  constraint ai_daily_plans_source_check check (source in ('ai','rules_fallback')),
  constraint ai_daily_plans_windows_check check (jsonb_typeof(work_windows) = 'array' and jsonb_array_length(work_windows) between 1 and 8)
);

create table if not exists public.ai_daily_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.ai_daily_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  sequence integer not null,
  role text not null,
  reason text not null,
  first_step text not null,
  effort_tip text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, task_id, starts_at),
  constraint ai_daily_plan_items_time_check check (ends_at > starts_at),
  constraint ai_daily_plan_items_role_check check (role in ('now','later','quick_win')),
  constraint ai_daily_plan_items_status_check check (status in ('pending','in_progress','paused','completed','returned'))
);

create table if not exists public.ai_analysis_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null,
  source_id uuid,
  model text not null,
  prompt_version text not null,
  input_hash text not null,
  output_json jsonb not null,
  source text not null default 'ai',
  accepted_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ai_analysis_events_source_check check (source in ('ai','rules_fallback')),
  constraint ai_analysis_events_type_check check (source_type in ('task_analysis','daily_plan'))
);

create index if not exists ai_daily_plans_user_date_idx on public.ai_daily_plans(user_id, plan_date, created_at desc);
create index if not exists ai_daily_plan_items_plan_sequence_idx on public.ai_daily_plan_items(plan_id, sequence);
create index if not exists ai_daily_plan_items_task_idx on public.ai_daily_plan_items(task_id);
create index if not exists ai_analysis_events_user_created_idx on public.ai_analysis_events(user_id, created_at desc);
create index if not exists ai_analysis_events_source_idx on public.ai_analysis_events(source_type, source_id);

alter table public.ai_daily_plans enable row level security;
alter table public.ai_daily_plan_items enable row level security;
alter table public.ai_analysis_events enable row level security;
create policy ai_daily_plans_own on public.ai_daily_plans
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy ai_daily_plan_items_own on public.ai_daily_plan_items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.ai_daily_plans plan
      where plan.id = plan_id and plan.user_id = (select auth.uid())
    )
  );
create policy ai_analysis_events_select_own on public.ai_analysis_events
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy ai_analysis_events_insert_own on public.ai_analysis_events
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Daily three-day reminder email queue.
-- ---------------------------------------------------------------------------

alter table public.notification_preferences
  add column if not exists email_digest_enabled boolean not null default false,
  add column if not exists email_digest_days integer not null default 3,
  add column if not exists email_digest_time time not null default '08:30';
alter table public.notification_preferences drop constraint if exists notification_preferences_email_digest_days_check;
alter table public.notification_preferences add constraint notification_preferences_email_digest_days_check
  check (email_digest_days between 1 and 7);

insert into public.notification_preferences(user_id, email_digest_enabled, email_digest_days, email_digest_time)
select profile.user_id, true, 3, '08:30'
from public.user_profiles profile
join auth.users users on users.id = profile.user_id
where profile.active
  and (
    lower(users.email) = 'derekcy0309@gmail.com'
    or lower(profile.display_name) = 'suki'
  )
on conflict (user_id) do update
set email_digest_enabled = true,
    email_digest_days = 3,
    email_digest_time = '08:30',
    updated_at = now();

create table if not exists public.email_digest_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  digest_date date not null,
  horizon_days integer not null default 3,
  item_count integer not null default 0,
  status text not null default 'processing',
  attempt_count integer not null default 1,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, digest_date),
  constraint email_digest_deliveries_status_check check (status in ('processing','sent','retry','failed','skipped')),
  constraint email_digest_deliveries_horizon_check check (horizon_days between 1 and 7)
);
create index if not exists email_digest_deliveries_user_date_idx
  on public.email_digest_deliveries(user_id, digest_date desc);
create index if not exists email_digest_deliveries_retry_idx
  on public.email_digest_deliveries(status, updated_at)
  where status in ('processing','retry');

alter table public.email_digest_deliveries enable row level security;
create policy email_digest_deliveries_own_select on public.email_digest_deliveries
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.claim_due_email_digests(
  p_secret text,
  p_digest_date date,
  p_limit integer default 10
)
returns table(
  delivery_id uuid,
  recipient_user_id uuid,
  recipient_email text,
  display_name text,
  timezone text,
  items jsonb
)
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.notification_dispatch_authorized(p_secret) then
    raise exception 'NOTIFICATION_DISPATCH_FORBIDDEN';
  end if;
  return query
  with candidate as (
    select
      profile.user_id,
      users.email,
      profile.display_name,
      coalesce(preference.timezone, profile.timezone, 'Asia/Hong_Kong') as timezone,
      coalesce(preference.email_digest_days, 3) as horizon_days,
      coalesce((
        select jsonb_agg(record.item order by record.due_date, record.sort_title)
        from (
          select
            task.due_date,
            task.title as sort_title,
            jsonb_build_object(
              'id', task.id,
              'kind', 'task',
              'title', task.title,
              'area', task.area,
              'dueDate', task.due_date,
              'nextAction', task.next_action
            ) as item
          from public.tasks task
          where task.deleted_at is null and task.archived_at is null
            and task.status not in ('done','cancelled')
            and task.due_date between p_digest_date
              and p_digest_date + greatest(coalesce(preference.email_digest_days, 3), 1) - 1
            and (
              task.owner_id = profile.user_id
              or (
                task.visibility = 'household'
                and task.household_id is not null
                and exists (
                  select 1 from public.household_members member
                  where member.household_id = task.household_id
                    and member.user_id = profile.user_id
                    and member.status = 'accepted'
                )
              )
              or exists (
                select 1 from public.assignments assignment
                where assignment.resource_type = 'task'
                  and assignment.resource_id = task.id
                  and assignment.assigned_to_id = profile.user_id
                  and assignment.status in ('accepted','in_progress','waiting','blocked')
              )
            )
          union all
          select
            item.due_date,
            item.title as sort_title,
            jsonb_build_object(
              'id', item.id,
              'kind', item.item_type,
              'title', case when item.sensitive then '一項私人' || case item.area when 'family' then '家庭' when 'work' then '工作' else '個人' end || '事項' else item.title end,
              'area', item.area,
              'dueDate', item.due_date,
              'nextAction', case when item.sensitive then null else item.next_action end
            ) as item
          from public.operating_items item
          where item.archived_at is null
            and item.status not in ('completed','cancelled')
            and item.due_date between p_digest_date
              and p_digest_date + greatest(coalesce(preference.email_digest_days, 3), 1) - 1
            and (
              item.owner_id = profile.user_id
              or (
                item.visibility = 'household'
                and item.household_id is not null
                and exists (
                  select 1 from public.household_members member
                  where member.household_id = item.household_id
                    and member.user_id = profile.user_id
                    and member.status = 'accepted'
                )
              )
            )
          order by due_date, sort_title
          limit 50
        ) record
      ), '[]'::jsonb) as items
    from public.user_profiles profile
    join auth.users users on users.id = profile.user_id and users.email is not null
    left join public.notification_preferences preference on preference.user_id = profile.user_id
    where profile.active
      and (
        lower(users.email) = 'derekcy0309@gmail.com'
        or lower(profile.display_name) = 'suki'
      )
      and coalesce(preference.email_digest_enabled, true)
  ), claimed as (
    insert into public.email_digest_deliveries(
      user_id, digest_date, horizon_days, item_count, status
    )
    select
      candidate.user_id,
      p_digest_date,
      candidate.horizon_days,
      jsonb_array_length(candidate.items),
      'processing'
    from candidate
    order by candidate.user_id
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
    on conflict (user_id, digest_date) do update
    set status = 'processing',
        attempt_count = public.email_digest_deliveries.attempt_count + 1,
        last_error = null,
        updated_at = now()
    where public.email_digest_deliveries.status in ('retry','failed')
    returning id, user_id
  )
  select claimed.id, candidate.user_id, candidate.email, candidate.display_name, candidate.timezone, candidate.items
  from claimed join candidate on candidate.user_id = claimed.user_id;
end;
$$;
revoke all on function public.claim_due_email_digests(text, date, integer) from public, authenticated;
grant execute on function public.claim_due_email_digests(text, date, integer) to anon, service_role;

create or replace function public.complete_due_email_digest(
  p_secret text,
  p_delivery_id uuid,
  p_status text,
  p_provider_message_id text default null,
  p_error text default null
)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.notification_dispatch_authorized(p_secret) then
    raise exception 'NOTIFICATION_DISPATCH_FORBIDDEN';
  end if;
  if p_status not in ('sent','retry','failed') then
    raise exception 'EMAIL_DIGEST_STATUS_INVALID';
  end if;
  update public.email_digest_deliveries
  set status = p_status,
      provider_message_id = left(p_provider_message_id, 500),
      last_error = left(p_error, 1000),
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      updated_at = now()
  where id = p_delivery_id and status = 'processing';
  return found;
end;
$$;
revoke all on function public.complete_due_email_digest(text, uuid, text, text, text) from public, authenticated;
grant execute on function public.complete_due_email_digest(text, uuid, text, text, text) to anon, service_role;

-- Public-schema tables are explicitly opted into the Data API and protected by RLS.
revoke all on public.households, public.household_members,
  public.google_calendar_connections, public.calendar_event_links,
  public.ai_daily_plans, public.ai_daily_plan_items, public.ai_analysis_events,
  public.email_digest_deliveries
from public, anon, authenticated;
grant select, insert, update on public.households, public.household_members to authenticated;
grant select, insert, update, delete on public.google_calendar_connections, public.calendar_event_links to authenticated;
grant select, insert, update, delete on public.ai_daily_plans, public.ai_daily_plan_items to authenticated;
grant select, insert on public.ai_analysis_events to authenticated;
grant select on public.email_digest_deliveries to authenticated;

comment on table public.ai_daily_plans is
  'Owner-private plans. They never create Google Calendar events; only confirmed operating_items schedules can sync.';
comment on table public.email_digest_deliveries is
  'Gentle per-user three-day due digest delivery audit. Message bodies are not retained.';
