-- Recurring task routines rollback.
-- Do not remove recurrence history or generated task links implicitly.

do $$
begin
  if exists (select 1 from public.task_recurrence_rules)
     or exists (select 1 from public.tasks where recurrence_rule_id is not null) then
    raise exception 'RECURRING_ROUTINES_ROLLBACK_REQUIRES_EXPLICIT_DATA_HANDLING';
  end if;
end;
$$;

drop trigger if exists generate_next_recurring_task_trigger on public.tasks;
drop trigger if exists validate_task_recurrence_reference_trigger on public.tasks;
drop trigger if exists validate_task_recurrence_rule_trigger on public.task_recurrence_rules;
drop function if exists private.generate_next_recurring_task();
drop function if exists private.next_task_recurrence_date(text, smallint[], integer, date, boolean, boolean, smallint, smallint, date);
drop function if exists private.validate_task_recurrence_reference();
drop function if exists private.validate_task_recurrence_rule();
drop table if exists public.task_recurrence_generations;
drop table if exists public.task_recurrence_rules;
drop index if exists public.tasks_recurrence_rule_status_idx;
alter table public.tasks drop column if exists recurrence_rule_id;
