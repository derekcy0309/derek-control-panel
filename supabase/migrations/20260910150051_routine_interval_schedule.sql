-- Simple routine intervals anchored to the user's scheduled due date.
-- Completing late never shifts the cadence. One completion still creates at
-- most one successor, so the migration does not pre-generate a backlog.

alter table public.task_recurrence_rules
  add column if not exists interval_value integer,
  add column if not exists interval_unit text,
  add column if not exists ends_on date;

alter table public.task_recurrence_rules
  drop constraint if exists task_recurrence_rules_frequency_check;
alter table public.task_recurrence_rules
  add constraint task_recurrence_rules_frequency_check
  check (frequency in ('daily', 'weekly', 'monthly', 'custom', 'interval'));

alter table public.task_recurrence_rules
  drop constraint if exists task_recurrence_rules_interval_schedule_check;
alter table public.task_recurrence_rules
  add constraint task_recurrence_rules_interval_schedule_check check (
    (
      frequency = 'interval'
      and interval_value between 1 and 3650
      and interval_unit in ('day', 'month', 'year')
      and deadline_mode = 'scheduled'
      and not night_shift_pattern
    )
    or (
      frequency <> 'interval'
      and interval_value is null
      and interval_unit is null
      and ends_on is null
    )
  );

create or replace function private.next_task_interval_date(
  p_anchor date,
  p_interval_value integer,
  p_interval_unit text,
  p_business_days_only boolean
)
returns date
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  candidate date;
  target_month date;
  target_months integer;
  last_day integer;
begin
  if p_anchor is null
     or p_interval_value is null
     or p_interval_value < 1
     or p_interval_unit not in ('day', 'month', 'year') then
    raise exception 'RECURRENCE_INTERVAL_INVALID';
  end if;

  if p_interval_unit = 'day' then
    candidate := p_anchor + p_interval_value;
  else
    target_months := case when p_interval_unit = 'year'
      then p_interval_value * 12 else p_interval_value end;
    target_month := (date_trunc('month', p_anchor)::date + make_interval(months => target_months))::date;
    last_day := extract(day from (target_month + interval '1 month - 1 day'))::integer;
    candidate := target_month + (least(extract(day from p_anchor)::integer, last_day) - 1);
  end if;

  while p_business_days_only and extract(dow from candidate) in (0, 6) loop
    candidate := candidate + 1;
  end loop;
  return candidate;
end;
$$;

revoke all on function private.next_task_interval_date(date, integer, text, boolean)
  from public, anon, authenticated;

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
  next_occurrence_date date;
  anchor_date date;
  project_reference uuid;
  follow_up_offset integer;
  reminder_time time;
  reminder_timezone text;
  reminder_at timestamptz;
begin
  if new.status <> 'done' or old.status = 'done' or new.recurrence_rule_id is null then
    return new;
  end if;

  select * into rule from public.task_recurrence_rules
  where id = new.recurrence_rule_id and owner_id = new.owner_id and is_active;
  if not found then return new; end if;

  -- Deliberately do not use greatest(..., current_date): a late completion must
  -- keep the user's original cadence instead of drifting to the completion day.
  anchor_date := coalesce(new.due_date, new.planned_date, rule.last_generated_for, current_date);
  next_occurrence_date := case when rule.frequency = 'interval'
    then private.next_task_interval_date(
      anchor_date, rule.interval_value, rule.interval_unit, rule.business_days_only
    )
    else private.next_task_recurrence_date(
      rule.frequency, rule.weekdays, rule.custom_interval_days, anchor_date,
      rule.business_days_only, rule.night_shift_pattern, rule.night_shift_on_days,
      rule.night_shift_off_days, rule.cycle_anchor_date
    )
  end;

  if rule.ends_on is not null and next_occurrence_date > rule.ends_on then
    update public.task_recurrence_rules
    set is_active = false, updated_at = now()
    where id = rule.id;
    return new;
  end if;

  insert into public.task_recurrence_generations (recurrence_rule_id, source_task_id, scheduled_for)
  values (rule.id, new.id, next_occurrence_date)
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
    due_date, follow_up_date, planned_date, status, next_action, definition_of_done,
    estimated_minutes, energy_level, context, risk, critical_path, safety_impact,
    child_impact, legal_impact, estimated_duration_days, buffer_days, project_id,
    recurrence_rule_id, visibility
  ) values (
    rule.owner_id, rule.owner_id, rule.owner_id,
    rule.template ->> 'scope', rule.template ->> 'area', rule.template ->> 'sourceType',
    rule.template ->> 'title', nullif(rule.template ->> 'description', ''),
    case when rule.deadline_mode = 'scheduled' then next_occurrence_date else null end,
    case when follow_up_offset is null then null else next_occurrence_date + follow_up_offset end,
    case when rule.deadline_mode = 'none' then next_occurrence_date else null end,
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
  set last_generated_at = now(), last_generated_for = next_occurrence_date, updated_at = now()
  where id = rule.id;

  if rule.deadline_mode = 'none' then
    select
      coalesce((select preference.today_reminder_time from public.notification_preferences preference where preference.user_id = rule.owner_id), time '09:00'),
      coalesce((select preference.timezone from public.notification_preferences preference where preference.user_id = rule.owner_id), 'Asia/Hong_Kong')
    into reminder_time, reminder_timezone;
    reminder_at := private.notification_local_time(next_occurrence_date, reminder_time, reminder_timezone);
    perform private.enqueue_notification(
      rule.owner_id,
      'recurrence_reminder',
      'task',
      next_task_id,
      reminder_at,
      'recurrence:' || rule.id::text || ':' || next_occurrence_date::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists generate_next_recurring_task_trigger on public.tasks;
create trigger generate_next_recurring_task_trigger
after update of status on public.tasks
for each row execute function private.generate_next_recurring_task();

revoke all on function private.generate_next_recurring_task()
  from public, anon, authenticated;
