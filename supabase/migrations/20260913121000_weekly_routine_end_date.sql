-- Reuse the existing recurrence engine for multi-select weekdays and allow the
-- same optional end date already available to interval routines.
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
      and (frequency = 'weekly' or ends_on is null)
    )
  );

