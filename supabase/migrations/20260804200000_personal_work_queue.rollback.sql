-- Data-safe rollback: restore the previous digest definition from
-- 20260804160000_suki_workflow_followups.rollback.sql first. The new waiting
-- columns are only removed when they contain no user data.

do $$
begin
  if exists (
    select 1 from public.tasks
    where nullif(btrim(waiting_for), '') is not null
       or nullif(btrim(waiting_on), '') is not null
  ) then
    raise exception 'PERSONAL_WORK_QUEUE_ROLLBACK_REQUIRES_WAITING_DATA_EXPORT';
  end if;
end;
$$;

drop index if exists public.tasks_waiting_follow_up_idx;
alter table public.tasks
  drop column if exists waiting_for,
  drop column if exists waiting_on;

