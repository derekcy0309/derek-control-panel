-- Idempotency support for the client-side Offline Write Queue.
-- This is additive: existing checkpoints and Focus Session history remain unchanged.

alter table public.task_checkpoints
  add column if not exists client_mutation_id uuid;

create unique index if not exists task_checkpoints_author_mutation_unique_idx
  on public.task_checkpoints(author_id, client_mutation_id)
  where client_mutation_id is not null;

-- Offline replays use a stable client mutation id. A repeated request therefore
-- returns the original checkpoint rather than creating another saved history row.
create or replace function public.save_task_checkpoint_idempotent(
  p_task_id uuid,
  p_state text,
  p_client_mutation_id uuid,
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
  if p_client_mutation_id is null then raise exception 'CHECKPOINT_MUTATION_REQUIRED'; end if;
  if p_state not in ('draft', 'saved') then raise exception 'CHECKPOINT_STATE_INVALID'; end if;
  if not (select private.current_user_can_checkpoint(p_task_id)) then
    raise exception 'CHECKPOINT_FORBIDDEN';
  end if;
  if p_state = 'saved'
     and nullif(btrim(coalesce(p_completed_summary, '')), '') is null
     and nullif(btrim(coalesce(p_current_position, '')), '') is null
     and nullif(btrim(coalesce(p_next_minimum_step, '')), '') is null
     and nullif(btrim(coalesce(p_blocked_reason, '')), '') is null then
    raise exception 'CHECKPOINT_CONTENT_REQUIRED';
  end if;

  select * into checkpoint
  from public.task_checkpoints
  where author_id = actor and client_mutation_id = p_client_mutation_id;
  if checkpoint.id is not null then
    return checkpoint;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_task_id::text || ':' || actor::text, 0));
  select * into checkpoint
  from public.task_checkpoints
  where author_id = actor and client_mutation_id = p_client_mutation_id;
  if checkpoint.id is not null then
    return checkpoint;
  end if;
  select * into checkpoint
  from public.task_checkpoints
  where task_id = p_task_id and author_id = actor and state = 'draft'
  for update;

  if checkpoint.id is null then
    insert into public.task_checkpoints (
      task_id, author_id, state, client_mutation_id, completed_summary,
      current_position, next_minimum_step, resource_links, blocked_reason, last_worked_at
    ) values (
      p_task_id, actor, p_state, p_client_mutation_id,
      nullif(btrim(p_completed_summary), ''), nullif(btrim(p_current_position), ''),
      nullif(btrim(p_next_minimum_step), ''), coalesce(p_resource_links, '[]'::jsonb),
      nullif(btrim(p_blocked_reason), ''), now()
    ) returning * into checkpoint;
  else
    update public.task_checkpoints
    set state = p_state,
        client_mutation_id = p_client_mutation_id,
        completed_summary = nullif(btrim(p_completed_summary), ''),
        current_position = nullif(btrim(p_current_position), ''),
        next_minimum_step = nullif(btrim(p_next_minimum_step), ''),
        resource_links = coalesce(p_resource_links, '[]'::jsonb),
        blocked_reason = nullif(btrim(p_blocked_reason), ''),
        last_worked_at = now()
    where id = checkpoint.id
    returning * into checkpoint;
  end if;
  return checkpoint;
end;
$$;
revoke all on function public.save_task_checkpoint_idempotent(uuid, text, uuid, text, text, text, jsonb, text) from public, anon;
grant execute on function public.save_task_checkpoint_idempotent(uuid, text, uuid, text, text, text, jsonb, text) to authenticated;

-- A queued Focus completion refers to its queued checkpoint by mutation id. This
-- avoids exposing or inventing a server checkpoint id while the device is offline.
create or replace function public.finish_focus_session_after_checkpoint(
  p_session_id uuid,
  p_status text,
  p_checkpoint_client_mutation_id uuid,
  p_block_reason text default null
)
returns public.focus_sessions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  checkpoint_id uuid;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_status not in ('completed', 'partial', 'interrupted') then raise exception 'FOCUS_SESSION_STATUS_INVALID'; end if;
  if p_checkpoint_client_mutation_id is null then raise exception 'FOCUS_SESSION_CHECKPOINT_REQUIRED'; end if;
  select id into checkpoint_id
  from public.task_checkpoints
  where author_id = actor
    and client_mutation_id = p_checkpoint_client_mutation_id
    and state = 'saved';
  if checkpoint_id is null then raise exception 'FOCUS_SESSION_CHECKPOINT_INVALID'; end if;
  return public.finish_focus_session(p_session_id, p_status, checkpoint_id, p_block_reason);
end;
$$;
revoke all on function public.finish_focus_session_after_checkpoint(uuid, text, uuid, text) from public, anon;
grant execute on function public.finish_focus_session_after_checkpoint(uuid, text, uuid, text) to authenticated;

comment on column public.task_checkpoints.client_mutation_id is
  'Stable browser-generated id for idempotent offline checkpoint replay. Null for legacy and normal online saves.';
