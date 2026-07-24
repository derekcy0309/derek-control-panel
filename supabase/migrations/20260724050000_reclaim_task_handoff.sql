-- Allow the sender of the current handoff to take the task back without
-- deleting any handoff history. This complements resolve_task_handoff_step,
-- which already lets the current recipient return it to the previous sender.
create or replace function public.reclaim_task_handoff(
  p_assignment_id uuid,
  p_note text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  current_assignment public.assignments%rowtype;
  current_progress integer;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(btrim(p_note), '') is null then raise exception 'HANDOFF_NOTE_REQUIRED'; end if;

  select * into current_assignment
  from public.assignments a
  where a.id = p_assignment_id
    and a.resource_type = 'task'
    and a.assigned_by_id = actor
    and a.status in ('pending_acceptance','accepted','in_progress','waiting','blocked')
  for update;
  if not found then raise exception 'HANDOFF_RECLAIM_FORBIDDEN'; end if;

  select coalesce(t.progress, current_assignment.progress, 0)
  into current_progress
  from public.tasks t
  where t.id = current_assignment.resource_id
    and t.deleted_at is null
    and t.archived_at is null
    and t.status not in ('done','cancelled')
  for update;
  if not found then raise exception 'TASK_NOT_AVAILABLE'; end if;

  -- Keep the active assignment in place until the task update has passed the
  -- field-level permission trigger.
  update public.tasks
  set assignee_id = actor,
      status = 'in_progress',
      blocked_reason = null,
      last_progress_at = now()
  where id = current_assignment.resource_id;

  update public.assignments
  set status = 'returned',
      completed_steps = completed_steps + 1,
      step_outcome = 'returned',
      completed_at = now(),
      returned_at = now(),
      last_note_at = now(),
      updated_at = now()
  where id = current_assignment.id;

  insert into public.task_handoff_notes(
    assignment_id, task_id, author_id, event_type, body, progress
  ) values (
    current_assignment.id,
    current_assignment.resource_id,
    actor,
    'returned',
    left(btrim(p_note), 5000),
    current_progress
  );

  return current_assignment.id;
end;
$$;

revoke all on function public.reclaim_task_handoff(uuid, text) from public, anon;
grant execute on function public.reclaim_task_handoff(uuid, text) to authenticated;
