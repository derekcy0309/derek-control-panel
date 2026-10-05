-- A deadline is optional in TaskForm, including when work days are selected.
-- Pure validator only: no task data, RLS policies or notification jobs change.
create or replace function private.valid_task_work_dates(p_start date, p_due date, p_dates date[])
returns boolean language sql immutable security invoker set search_path = '' as $$
  select p_start is not null and (p_due is null or p_start <= p_due)
    and p_dates is not null and cardinality(p_dates) between 1 and 90
    and not exists (
      select 1 from unnest(p_dates) as selected(day)
      where selected.day is null or selected.day < p_start
        or (p_due is not null and selected.day > p_due)
    )
    and cardinality(p_dates) = (select count(distinct selected.day) from unnest(p_dates) as selected(day));
$$;
revoke all on function private.valid_task_work_dates(date, date, date[]) from public, anon;
grant execute on function private.valid_task_work_dates(date, date, date[]) to authenticated;
