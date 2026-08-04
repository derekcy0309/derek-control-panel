-- Three-role daily workflow. Additive only: no existing task, finance or account
-- rows are updated, deleted or recreated by this migration.
-- Before production: take a Supabase backup and verify the rollback in Preview.

alter table public.user_profiles
  add column if not exists workspace_role text not null default 'general';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_workspace_role_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_workspace_role_check
      check (workspace_role in ('general', 'derek', 'suki', 'amigo'));
  end if;
end $$;

alter table public.tasks
  add column if not exists case_code text,
  add column if not exists task_type text not null default 'general',
  add column if not exists needs_decision_from_id uuid references auth.users(id) on delete set null,
  add column if not exists decision_resolved_at timestamptz,
  add column if not exists decision_resolved_by_id uuid references auth.users(id) on delete set null,
  add column if not exists materials_required text,
  add column if not exists rn_required boolean not null default false,
  add column if not exists client_update_required boolean not null default false,
  add column if not exists client_request_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_task_type_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_task_type_check
      check (task_type in (
        'general', 'intake', 'scheduling', 'materials', 'rn_coordination',
        'follow_up', 'sop', 'ai_document', 'system_issue', 'compliance',
        'training', 'assessment', 'family_conference'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_decision_resolution_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_decision_resolution_check
      check (
        (decision_resolved_at is null and decision_resolved_by_id is null)
        or (decision_resolved_at is not null and decision_resolved_by_id is not null)
      );
  end if;
end $$;

create unique index if not exists tasks_owner_client_request_unique
  on public.tasks(owner_id, client_request_id)
  where client_request_id is not null;

create index if not exists tasks_open_decision_owner_idx
  on public.tasks(needs_decision_from_id, due_date)
  where needs_decision_from_id is not null
    and decision_resolved_at is null
    and deleted_at is null
    and archived_at is null;

create index if not exists tasks_decision_resolved_by_idx
  on public.tasks(decision_resolved_by_id)
  where decision_resolved_by_id is not null;

-- Preserve the current field-level permission model and add one narrow path:
-- the explicitly named decision owner may only stamp the decision fields.
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

  if actor = old.needs_decision_from_id
     and old.decision_resolved_at is null
     and new.needs_decision_from_id = old.needs_decision_from_id
     and new.decision_resolved_at is not null
     and new.decision_resolved_by_id = actor
     and (
       to_jsonb(new) - array[
         'decision_resolved_at','decision_resolved_by_id','last_progress_at','updated_at'
       ]
       =
       to_jsonb(old) - array[
         'decision_resolved_at','decision_resolved_by_id','last_progress_at','updated_at'
       ]
     ) then
    return new;
  end if;

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

  if previous_actor is not null
     and (
       new.assignee_id is not distinct from old.assignee_id
       or new.assignee_id = actor
       or (new.assignee_id = previous_actor and new.status in ('in_progress','waiting'))
       or (new.assignee_id is null and new.status = 'done')
     )
     and (
       to_jsonb(new) - array[
         'status','progress','blocked_reason','completed_at','last_progress_at',
         'actual_minutes','updated_at','assignee_id','due_date','follow_up_date'
       ]
       =
       to_jsonb(old) - array[
         'status','progress','blocked_reason','completed_at','last_progress_at',
         'actual_minutes','updated_at','assignee_id','due_date','follow_up_date'
       ]
     ) then
    return new;
  end if;

  if allowed_permission is null
     and old.area = 'family'
     and old.visibility = 'household'
     and old.household_id is not null
     and exists (
       select 1 from public.household_members member
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

alter table public.notification_preferences
  add column if not exists quiet_mode_until timestamptz;

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
  desired_at timestamptz := p_desired_at;
  local_desired timestamp;
  local_date date;
  local_time time;
  allowed_local timestamp;
begin
  select *
  into preference
  from public.notification_preferences
  where user_id = p_user_id;

  if not found then
    return desired_at;
  end if;

  if preference.quiet_mode_until is not null
     and preference.quiet_mode_until > desired_at then
    desired_at := preference.quiet_mode_until;
  end if;

  if not preference.quiet_hours_enabled
     or preference.quiet_hours_start = preference.quiet_hours_end then
    return desired_at;
  end if;

  local_desired := desired_at at time zone preference.timezone;
  local_date := local_desired::date;
  local_time := local_desired::time;

  if preference.quiet_hours_start < preference.quiet_hours_end then
    if local_time >= preference.quiet_hours_start
       and local_time < preference.quiet_hours_end then
      allowed_local := local_date + preference.quiet_hours_end;
      return allowed_local at time zone preference.timezone;
    end if;
    return desired_at;
  end if;

  if local_time >= preference.quiet_hours_start then
    allowed_local := (local_date + 1) + preference.quiet_hours_end;
    return allowed_local at time zone preference.timezone;
  end if;
  if local_time < preference.quiet_hours_end then
    allowed_local := local_date + preference.quiet_hours_end;
    return allowed_local at time zone preference.timezone;
  end if;
  return desired_at;
end;
$$;

revoke all on function private.notification_after_quiet_hours(uuid, timestamptz)
  from public, anon, authenticated;

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
  urgent_safety boolean := false;
  delivery_time timestamptz;
begin
  if not private.notification_kind_enabled(p_user_id, p_kind) then return null; end if;
  if p_resource_type = 'task' then
    select coalesce(task.safety_impact and task.risk = 'high', false)
    into urgent_safety
    from public.tasks task
    where task.id = p_resource_id;
  end if;
  delivery_time := case when urgent_safety
    then greatest(p_desired_at, now())
    else private.notification_after_quiet_hours(p_user_id, greatest(p_desired_at, now()))
  end;
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
    p_user_id, p_kind, p_resource_type, p_resource_id, delivery_time,
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

create or replace function public.set_current_user_quiet_mode(
  p_until timestamptz
)
returns setof public.notification_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_until is not null
     and (p_until <= now() or p_until > now() + interval '7 days') then
    raise exception 'QUIET_MODE_UNTIL_INVALID';
  end if;

  insert into public.notification_preferences(user_id, quiet_mode_until, updated_at)
  values (actor, p_until, now())
  on conflict (user_id) do update
    set quiet_mode_until = excluded.quiet_mode_until,
        updated_at = now();

  if p_until is not null then
    update public.notification_deliveries
    set deliver_at = greatest(deliver_at, p_until),
        updated_at = now()
    where user_id = actor
      and status in ('scheduled', 'retry')
      and deliver_at < p_until
      and not (
        resource_type = 'task'
        and exists (
          select 1 from public.tasks task
          where task.id = resource_id
            and task.safety_impact
            and task.risk = 'high'
        )
      );
  end if;

  insert into public.activity_logs(resource_type, resource_id, actor_id, action, summary)
  values (
    'notification_preferences', actor, actor,
    case when p_until is null then 'quiet_mode_resumed' else 'quiet_mode_enabled' end,
    case when p_until is null then '已恢復一般通知' else '已暫停非緊急通知' end
  );

  return query
    select preference.*
    from public.notification_preferences preference
    where preference.user_id = actor;
end;
$$;

revoke all on function public.set_current_user_quiet_mode(timestamptz)
  from public, anon;
grant execute on function public.set_current_user_quiet_mode(timestamptz)
  to authenticated;
