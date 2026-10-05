-- Prefer reverting the application only; this additive validator remains compatible.
-- Refuse a database rollback that would invalidate newly saved no-deadline schedules.
begin;
lock table public.tasks in share row exclusive mode;
do $$ begin
  if exists (select 1 from public.tasks where work_dates is not null and due_date is null) then
    raise exception 'ROLLBACK_UNSAFE: keep the optional-deadline validator; existing schedules have no deadline';
  end if;
end $$;
create or replace function private.valid_task_work_dates(p_start date, p_due date, p_dates date[])
returns boolean language sql immutable security invoker set search_path = '' as $$
  select p_start is not null and p_due is not null and p_start <= p_due
    and p_dates is not null and cardinality(p_dates) between 1 and 90
    and not exists (
      select 1 from unnest(p_dates) as selected(day)
      where selected.day is null or selected.day < p_start or selected.day > p_due
    )
    and cardinality(p_dates) = (select count(distinct selected.day) from unnest(p_dates) as selected(day));
$$;
revoke all on function private.valid_task_work_dates(date, date, date[]) from public, anon;
grant execute on function private.valid_task_work_dates(date, date, date[]) to authenticated;
commit;
