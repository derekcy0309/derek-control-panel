-- Life OS boundary hardening
-- 1. Unprocessed Inbox capture always remains private.
-- 2. One confirmed schedule maps to one Google Calendar event.

create unique index if not exists calendar_event_links_item_unique_idx
  on public.calendar_event_links (operating_item_id);

create or replace function private.apply_family_visibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_household_id uuid;
begin
  if tg_table_name = 'operating_items' and new.item_type = 'inbox' then
    new.visibility := 'private';
    new.household_id := null;
    return new;
  end if;

  if new.area = 'family' then
    select hm.household_id
      into target_household_id
      from public.household_members hm
     where hm.user_id = new.owner_id
       and hm.status = 'accepted'
     order by hm.created_at
     limit 1;

    if target_household_id is not null then
      new.visibility := 'household';
      new.household_id := target_household_id;
    else
      new.visibility := 'private';
      new.household_id := null;
    end if;
  else
    if new.visibility = 'household' then
      raise exception 'Only family resources can use household visibility';
    end if;

    new.household_id := null;
  end if;

  return new;
end;
$$;

comment on function private.apply_family_visibility() is
  'Shares processed family resources with an accepted household while keeping raw Inbox capture private.';

revoke all on function private.apply_family_visibility() from public, anon, authenticated, service_role;

-- Accepted household members may progress shared family work, but ownership,
-- content and privacy fields remain controlled by the owner unless separately
-- shared with a stronger explicit permission.
create or replace function private.enforce_task_update_permission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  allowed_permission text;
  previous_actor uuid;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if actor = old.owner_id then return new; end if;

  select share.permission into allowed_permission
  from public.share_records share
  where share.resource_type = 'task'
    and share.resource_id = old.id
    and share.shared_with_user_id = actor
    and share.revoked_at is null
    and (share.expires_at is null or share.expires_at > now())
  order by share.created_at desc
  limit 1;

  select assignment.assigned_by_id into previous_actor
  from public.assignments assignment
  where assignment.resource_type = 'task'
    and assignment.resource_id = old.id
    and assignment.assigned_to_id = actor
    and assignment.status in ('accepted','in_progress','waiting','blocked')
  order by assignment.created_at desc
  limit 1;

  if allowed_permission is null and previous_actor is not null then
    allowed_permission := 'update_status';
  end if;

  if allowed_permission is null
     and old.area = 'family'
     and old.visibility = 'household'
     and old.household_id is not null
     and exists (
       select 1
       from public.household_members member
       where member.household_id = old.household_id
         and member.user_id = actor
         and member.status = 'accepted'
     ) then
    allowed_permission := 'update_status';
  end if;

  if allowed_permission = 'co_owner' and exists (
    select 1
    from public.joint_memberships joint
    where joint.resource_type = 'task'
      and joint.resource_id = old.id
      and joint.user_id = actor
      and joint.accepted_at is not null
      and joint.removed_at is null
  ) then
    return new;
  end if;

  if allowed_permission = 'edit' then
    if new.owner_id <> old.owner_id
       or new.user_id <> old.user_id
       or new.created_by_id <> old.created_by_id
       or new.visibility <> old.visibility
       or new.household_id is distinct from old.household_id then
      raise exception 'OWNER_FIELDS_IMMUTABLE';
    end if;
    return new;
  end if;

  if allowed_permission = 'update_status'
     and (
       new.assignee_id is not distinct from old.assignee_id
       or new.assignee_id = actor
       or (new.assignee_id = previous_actor and new.status in ('in_progress','waiting'))
       or (new.assignee_id is null and new.status = 'done')
     )
     and (
       to_jsonb(new) - array[
         'status','progress','blocked_reason','completed_at','last_progress_at',
         'actual_minutes','updated_at','assignee_id'
       ]
       =
       to_jsonb(old) - array[
         'status','progress','blocked_reason','completed_at','last_progress_at',
         'actual_minutes','updated_at','assignee_id'
       ]
     ) then
    return new;
  end if;

  raise exception 'TASK_UPDATE_FORBIDDEN';
end;
$$;

revoke all on function private.enforce_task_update_permission() from public, anon, authenticated, service_role;

create or replace function private.enforce_operating_item_update_permission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  allowed_permission text;
  household_status_access boolean := false;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if actor = old.owner_id then return new; end if;

  select share.permission into allowed_permission
  from public.share_records share
  where share.resource_type = 'operating_item'
    and share.resource_id = old.id
    and share.shared_with_user_id = actor
    and share.revoked_at is null
    and (share.expires_at is null or share.expires_at > now())
  order by share.created_at desc
  limit 1;

  household_status_access :=
    old.area = 'family'
    and old.visibility = 'household'
    and old.household_id is not null
    and exists (
      select 1
      from public.household_members member
      where member.household_id = old.household_id
        and member.user_id = actor
        and member.status = 'accepted'
    );

  if allowed_permission = 'co_owner' and exists (
    select 1
    from public.joint_memberships joint
    where joint.resource_type = 'operating_item'
      and joint.resource_id = old.id
      and joint.user_id = actor
      and joint.accepted_at is not null
      and joint.removed_at is null
  ) then
    if new.owner_id <> old.owner_id
       or new.created_by_id <> old.created_by_id
       or new.visibility <> old.visibility
       or new.household_id is distinct from old.household_id then
      raise exception 'OWNER_FIELDS_IMMUTABLE';
    end if;
    return new;
  end if;

  if allowed_permission = 'edit' then
    if new.owner_id <> old.owner_id
       or new.created_by_id <> old.created_by_id
       or new.visibility <> old.visibility
       or new.household_id is distinct from old.household_id then
      raise exception 'OWNER_FIELDS_IMMUTABLE';
    end if;
    return new;
  end if;

  if (
       household_status_access
       or exists (
         select 1
         from public.assignments assignment
         where assignment.resource_type = 'operating_item'
           and assignment.resource_id = old.id
           and assignment.assigned_to_id = actor
           and assignment.status in ('accepted','in_progress','blocked')
       )
     )
     and (new.assignee_id is not distinct from old.assignee_id or new.assignee_id = actor)
     and (
       to_jsonb(new) - array['status','last_progress_at','updated_at','assignee_id']
       =
       to_jsonb(old) - array['status','last_progress_at','updated_at','assignee_id']
     ) then
    return new;
  end if;

  raise exception 'OPERATING_ITEM_UPDATE_FORBIDDEN';
end;
$$;

revoke all on function private.enforce_operating_item_update_permission() from public, anon, authenticated, service_role;
