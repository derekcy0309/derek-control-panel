-- Do not silently discard a weekly ending policy during rollback.
do $$
begin
  if exists (
    select 1 from public.task_recurrence_rules
    where frequency = 'weekly' and ends_on is not null
  ) then
    raise exception 'WEEKLY_ROUTINE_END_DATE_ROLLBACK_REQUIRES_EXPLICIT_DATA_HANDLING';
  end if;
end $$;

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

