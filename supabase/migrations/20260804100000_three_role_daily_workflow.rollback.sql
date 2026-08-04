-- Explicit rollback for 20260804100000_three_role_daily_workflow.sql.
-- Export the newly added task/profile fields before running this rollback if they
-- already contain production data. Existing task, finance and account rows remain.

drop function if exists public.set_current_user_quiet_mode(timestamptz);

create or replace function private.enqueue_notification(
  p_user_id uuid,
  p_kind text,
  p_resource_type text,
  p_resource_id uuid,
  p_desired_at timestamptz,
  p_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_id uuid;
  title_text text;
  body_text text;
  path_text text;
begin
  if not private.notification_kind_enabled(p_user_id, p_kind) then return null; end if;
  title_text := case p_kind
    when 'today_first' then '今日第一步' when 'deadline' then '限期提醒'
    when 'waiting_followup' then '跟進提醒' when 'handover_received' then '收到工作交接'
    when 'handover_accepted' then '工作交接已接受' when 'handover_information' then '工作交接有新資料'
    when 'handover_returned' then '工作已交回' when 'handover_completed' then '交接步驟已完成'
    when 'focus_complete' then '專注時段完成' when 'daily_shutdown' then '今日收尾'
    when 'task_notice' then '任務通知' when 'reminder' then '活動提醒'
    else '通知測試' end;
  body_text := case p_kind
    when 'today_first' then '你已確認一項現在可以開始的工作'
    when 'deadline' then '一項工作限期接近' when 'waiting_followup' then '一項等待事項已到跟進日期'
    when 'handover_received' then '對方交咗一項工作畀你' when 'handover_accepted' then '對方已接受一項工作交接'
    when 'handover_information' then '一項交接有新進度或需要資料' when 'handover_returned' then '一項工作已交回上一手'
    when 'handover_completed' then '一項交接步驟已完成' when 'focus_complete' then '時間到了，記下 checkpoint 方便下次接續'
    when 'daily_shutdown' then '可以用幾分鐘記下未完工作同下一步'
    when 'task_notice' then '有人通知你一項任務' when 'reminder' then '你有一項已安排活動'
    else '瀏覽器通知已成功連接' end;
  path_text := case when p_kind = 'deadline' then '/deadlines'
    when p_kind = 'waiting_followup' then '/workspace/waiting'
    when p_kind like 'handover_%' then '/workspace/handover' else '/' end;
  insert into public.notification_deliveries(
    user_id, kind, resource_type, resource_id, deliver_at,
    dedupe_key, generic_title, generic_body, target_path
  ) values (
    p_user_id, p_kind, p_resource_type, p_resource_id,
    private.notification_after_quiet_hours(p_user_id, greatest(p_desired_at, now())),
    left(p_dedupe_key, 500), title_text, body_text, path_text
  )
  on conflict (user_id, dedupe_key) do nothing returning id into delivery_id;
  return delivery_id;
end;
$$;

revoke all on function private.enqueue_notification(uuid, text, text, uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function private.enqueue_notification(uuid, text, text, uuid, timestamptz, text)
  to authenticated;

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

revoke all on function private.enforce_task_update_permission()
  from public, anon, authenticated, service_role;

create or replace function private.notification_after_quiet_hours(
  p_user_id uuid,
  p_desired_at timestamptz
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  preference public.notification_preferences%rowtype;
  local_desired timestamp;
  local_date date;
  local_time time;
  allowed_local timestamp;
begin
  select *
  into preference
  from public.notification_preferences
  where user_id = p_user_id;

  if not found or not preference.quiet_hours_enabled
     or preference.quiet_hours_start = preference.quiet_hours_end then
    return p_desired_at;
  end if;

  local_desired := p_desired_at at time zone preference.timezone;
  local_date := local_desired::date;
  local_time := local_desired::time;

  if preference.quiet_hours_start < preference.quiet_hours_end then
    if local_time >= preference.quiet_hours_start
       and local_time < preference.quiet_hours_end then
      allowed_local := local_date + preference.quiet_hours_end;
      return allowed_local at time zone preference.timezone;
    end if;
    return p_desired_at;
  end if;

  if local_time >= preference.quiet_hours_start then
    allowed_local := (local_date + 1) + preference.quiet_hours_end;
    return allowed_local at time zone preference.timezone;
  end if;
  if local_time < preference.quiet_hours_end then
    allowed_local := local_date + preference.quiet_hours_end;
    return allowed_local at time zone preference.timezone;
  end if;
  return p_desired_at;
end;
$$;

revoke all on function private.notification_after_quiet_hours(uuid, timestamptz)
  from public, anon, authenticated;

alter table public.notification_preferences
  drop column if exists quiet_mode_until;

drop index if exists public.tasks_decision_resolved_by_idx;
drop index if exists public.tasks_open_decision_owner_idx;
drop index if exists public.tasks_owner_client_request_unique;

alter table public.tasks
  drop constraint if exists tasks_decision_resolution_check,
  drop constraint if exists tasks_task_type_check,
  drop column if exists client_request_id,
  drop column if exists client_update_required,
  drop column if exists rn_required,
  drop column if exists materials_required,
  drop column if exists decision_resolved_by_id,
  drop column if exists decision_resolved_at,
  drop column if exists needs_decision_from_id,
  drop column if exists task_type,
  drop column if exists case_code;

alter table public.user_profiles
  drop constraint if exists user_profiles_workspace_role_check,
  drop column if exists workspace_role;
