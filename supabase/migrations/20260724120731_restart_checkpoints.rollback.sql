-- Roll back only the Restart Checkpoint feature.
-- Existing tasks, assignments, shares and all other production data are preserved.
-- Saved checkpoint history is removed by this rollback, so export it first if needed.

drop view if exists public.latest_task_checkpoints;
drop function if exists public.save_task_checkpoint(uuid, text, text, text, text, jsonb, text);
drop policy if exists task_checkpoints_delete_own_draft on public.task_checkpoints;
drop policy if exists task_checkpoints_update_own_draft on public.task_checkpoints;
drop policy if exists task_checkpoints_insert_author on public.task_checkpoints;
drop policy if exists task_checkpoints_select_authorized on public.task_checkpoints;
drop trigger if exists validate_task_checkpoint_trigger on public.task_checkpoints;
drop function if exists private.validate_task_checkpoint();
drop table if exists public.task_checkpoints;
drop function if exists private.current_user_can_checkpoint(uuid);
