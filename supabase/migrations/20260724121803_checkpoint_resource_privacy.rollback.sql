-- Roll back the separate private resource store while keeping checkpoints.
-- Resource URLs are discarded instead of being moved into shared checkpoint
-- rows, so rollback does not introduce a privacy leak.

create or replace function public.save_task_checkpoint(
  p_task_id uuid,
  p_state text,
  p_completed_summary text default null,
  p_current_position text default null,
  p_next_minimum_step text default null,
  p_resource_links jsonb default '[]'::jsonb,
  p_blocked_reason text default null
)
returns public.task_checkpoints
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  checkpoint public.task_checkpoints;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_state not in ('draft', 'saved') then raise exception 'CHECKPOINT_STATE_INVALID'; end if;
  if not (select private.current_user_can_checkpoint(p_task_id)) then raise exception 'CHECKPOINT_FORBIDDEN'; end if;
  if p_state = 'saved'
     and nullif(btrim(coalesce(p_completed_summary, '')), '') is null
     and nullif(btrim(coalesce(p_current_position, '')), '') is null
     and nullif(btrim(coalesce(p_next_minimum_step, '')), '') is null
     and nullif(btrim(coalesce(p_blocked_reason, '')), '') is null then
    raise exception 'CHECKPOINT_CONTENT_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_task_id::text || ':' || actor::text, 0));
  select * into checkpoint from public.task_checkpoints
  where task_id = p_task_id and author_id = actor and state = 'draft' for update;
  if checkpoint.id is null then
    insert into public.task_checkpoints (
      task_id, author_id, state, completed_summary, current_position,
      next_minimum_step, resource_links, blocked_reason, last_worked_at
    ) values (
      p_task_id, actor, p_state, nullif(btrim(p_completed_summary), ''),
      nullif(btrim(p_current_position), ''), nullif(btrim(p_next_minimum_step), ''),
      '[]'::jsonb, nullif(btrim(p_blocked_reason), ''), now()
    ) returning * into checkpoint;
  else
    update public.task_checkpoints set
      state = p_state,
      completed_summary = nullif(btrim(p_completed_summary), ''),
      current_position = nullif(btrim(p_current_position), ''),
      next_minimum_step = nullif(btrim(p_next_minimum_step), ''),
      resource_links = '[]'::jsonb,
      blocked_reason = nullif(btrim(p_blocked_reason), ''),
      last_worked_at = now()
    where id = checkpoint.id returning * into checkpoint;
  end if;
  return checkpoint;
end;
$$;

drop trigger if exists validate_task_checkpoint_resource_trigger on public.task_checkpoint_resources;
drop function if exists private.validate_task_checkpoint_resource();
drop table if exists public.task_checkpoint_resources;
