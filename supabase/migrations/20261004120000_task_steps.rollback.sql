-- Only for a deliberate rollback after backing up step data.
drop function if exists public.restore_backup_v2(jsonb);
drop view if exists public.task_current_steps;
drop trigger if exists validate_task_step_trigger on public.task_steps;
drop function if exists private.validate_task_step();
drop table if exists public.task_steps;
