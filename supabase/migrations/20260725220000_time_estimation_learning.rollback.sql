-- Export or explicitly remove personal time observations before rollback.
-- Existing tasks and their estimate/actual fields are intentionally preserved.
do $$
begin
  if exists (select 1 from public.task_time_observations limit 1) then
    raise exception 'TIME_ESTIMATION_LEARNING_ROLLBACK_REQUIRES_EXPLICIT_DATA_HANDLING';
  end if;
end;
$$;

drop trigger if exists capture_task_time_observation on public.tasks;
drop function if exists public.capture_task_time_observation();
drop function if exists public.time_estimate_suggestion(text, text, text, integer);
drop policy if exists task_time_observations_select_self on public.task_time_observations;
drop table if exists public.task_time_observations;
