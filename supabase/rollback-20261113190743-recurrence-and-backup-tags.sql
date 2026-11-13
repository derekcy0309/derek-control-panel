-- First roll the app back to the prior deployment (restore_backup_v2).
-- Stop switch for migration 20261113190743.
-- This stop switch preserves ALL task/tag/finance data and existing migrations.
begin;
drop trigger if exists inherit_recurring_task_tags_trigger on public.task_recurrence_generations;
revoke all on function public.restore_backup_v3(jsonb) from public, anon, authenticated;
commit;
