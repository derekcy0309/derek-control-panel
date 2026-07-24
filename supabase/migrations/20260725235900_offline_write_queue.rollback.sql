-- Offline queue rollback is deliberately guarded: client mutation ids may be
-- needed to deduplicate a pending device replay. Existing task/checkpoint data is
-- never removed automatically.
do $$
begin
  if exists (select 1 from public.task_checkpoints where client_mutation_id is not null) then
    raise exception 'offline_write_queue_rollback_requires_explicit_data_handling';
  end if;
end;
$$;

revoke all on function public.finish_focus_session_after_checkpoint(uuid, text, uuid, text) from authenticated;
drop function if exists public.finish_focus_session_after_checkpoint(uuid, text, uuid, text);
revoke all on function public.save_task_checkpoint_idempotent(uuid, text, uuid, text, text, text, jsonb, text) from authenticated;
drop function if exists public.save_task_checkpoint_idempotent(uuid, text, uuid, text, text, text, jsonb, text);
drop index if exists public.task_checkpoints_author_mutation_unique_idx;
alter table public.task_checkpoints drop column if exists client_mutation_id;
