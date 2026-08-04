-- Rollback for recurring no-deadline reminders.
-- Export task_recurrence_rules.deadline_mode and notification_preferences.recurrence_enabled
-- before running if those new preferences must be retained outside this schema version.

drop function if exists public.set_task_recurrence_deadline_mode(uuid, text);

update public.tasks task
set due_date = coalesce(task.due_date, task.planned_date, rule.last_generated_for)
from public.task_recurrence_rules rule
where rule.id = task.recurrence_rule_id
  and rule.deadline_mode = 'none'
  and task.status not in ('done', 'cancelled')
  and task.deleted_at is null
  and task.archived_at is null;

update public.notification_deliveries
set kind = 'task_notice'
where kind = 'recurrence_reminder';

alter table public.notification_deliveries
  drop constraint if exists notification_delivery_kind_check;
alter table public.notification_deliveries
  add constraint notification_delivery_kind_check check (kind in (
    'today_first', 'deadline', 'waiting_followup',
    'handover_received', 'handover_accepted', 'handover_information',
    'handover_returned', 'handover_completed',
    'focus_complete', 'daily_shutdown', 'task_notice', 'reminder', 'test'
  ));

create or replace function private.notification_kind_enabled(p_user_id uuid, p_kind text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select preference.browser_enabled and case
      when p_kind = 'today_first' then preference.today_first_enabled
      when p_kind = 'deadline' then preference.deadline_enabled
      when p_kind = 'waiting_followup' then preference.waiting_enabled
      when p_kind like 'handover_%' then preference.handover_enabled
      when p_kind = 'focus_complete' then preference.focus_enabled
      when p_kind = 'daily_shutdown' then preference.shutdown_enabled
      when p_kind = 'task_notice' then preference.task_notice_enabled
      when p_kind = 'reminder' then preference.reminder_enabled
      when p_kind = 'test' then true
      else false
    end
    from public.notification_preferences preference
    where preference.user_id = p_user_id
  ), false);
$$;

revoke all on function private.notification_kind_enabled(uuid, text)
  from public, anon, authenticated;
grant execute on function private.notification_kind_enabled(uuid, text)
  to authenticated;

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

create or replace function private.generate_next_recurring_task()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule public.task_recurrence_rules%rowtype;
  generation_id uuid;
  next_task_id uuid;
  next_due_date date;
  anchor_date date;
  project_reference uuid;
  follow_up_offset integer;
begin
  if new.status <> 'done' or old.status = 'done' or new.recurrence_rule_id is null then
    return new;
  end if;

  select * into rule from public.task_recurrence_rules
  where id = new.recurrence_rule_id and owner_id = new.owner_id and is_active;
  if not found then return new; end if;

  anchor_date := greatest(coalesce(new.due_date, current_date), current_date);
  next_due_date := private.next_task_recurrence_date(
    rule.frequency, rule.weekdays, rule.custom_interval_days, anchor_date,
    rule.business_days_only, rule.night_shift_pattern, rule.night_shift_on_days,
    rule.night_shift_off_days, rule.cycle_anchor_date
  );

  insert into public.task_recurrence_generations (recurrence_rule_id, source_task_id, scheduled_for)
  values (rule.id, new.id, next_due_date)
  on conflict (recurrence_rule_id, source_task_id) do nothing
  returning id into generation_id;
  if generation_id is null then return new; end if;

  if nullif(rule.template ->> 'projectId', '') is not null
     and exists (
       select 1 from public.operating_items project
       where project.id = (rule.template ->> 'projectId')::uuid
         and project.item_type = 'project' and project.archived_at is null
     ) then
    project_reference := (rule.template ->> 'projectId')::uuid;
  end if;
  follow_up_offset := nullif(rule.template ->> 'followUpOffsetDays', '')::integer;

  insert into public.tasks (
    user_id, owner_id, created_by_id, scope, area, source_type, title, description,
    due_date, follow_up_date, status, next_action, definition_of_done,
    estimated_minutes, energy_level, context, risk, critical_path, safety_impact,
    child_impact, legal_impact, estimated_duration_days, buffer_days, project_id,
    recurrence_rule_id, visibility
  ) values (
    rule.owner_id, rule.owner_id, rule.owner_id,
    rule.template ->> 'scope', rule.template ->> 'area', rule.template ->> 'sourceType',
    rule.template ->> 'title', nullif(rule.template ->> 'description', ''),
    next_due_date,
    case when follow_up_offset is null then null else next_due_date + follow_up_offset end,
    'not_started', nullif(rule.template ->> 'nextAction', ''), nullif(rule.template ->> 'definitionOfDone', ''),
    nullif(rule.template ->> 'estimatedMinutes', '')::integer,
    nullif(rule.template ->> 'energyLevel', ''), nullif(rule.template ->> 'context', ''),
    rule.template ->> 'risk', coalesce((rule.template ->> 'criticalPath')::boolean, false),
    coalesce((rule.template ->> 'safetyImpact')::boolean, false),
    coalesce((rule.template ->> 'childImpact')::boolean, false),
    coalesce((rule.template ->> 'legalImpact')::boolean, false),
    nullif(rule.template ->> 'estimatedDurationDays', '')::integer,
    coalesce(nullif(rule.template ->> 'bufferDays', '')::integer, 0),
    project_reference, rule.id, 'private'
  ) returning id into next_task_id;

  update public.task_recurrence_generations
  set generated_task_id = next_task_id
  where id = generation_id;
  update public.task_recurrence_rules
  set last_generated_at = now(), last_generated_for = next_due_date, updated_at = now()
  where id = rule.id;
  return new;
end;
$$;

drop trigger if exists generate_next_recurring_task_trigger on public.tasks;
create trigger generate_next_recurring_task_trigger
after update of status on public.tasks
for each row execute function private.generate_next_recurring_task();

revoke all on function private.generate_next_recurring_task()
  from public, anon, authenticated;

alter table public.task_recurrence_rules
  drop constraint if exists task_recurrence_rules_deadline_mode_check;
alter table public.task_recurrence_rules
  drop column if exists deadline_mode;

alter table public.notification_preferences
  drop column if exists recurrence_enabled;
