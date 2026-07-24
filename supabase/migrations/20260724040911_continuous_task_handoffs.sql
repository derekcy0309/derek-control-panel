-- Continuous task handoffs keep a case alive across multiple completed steps.
-- A task is only finished when a participant explicitly closes the case.

alter table public.assignments
  add column if not exists parent_assignment_id uuid references public.assignments(id) on delete set null,
  add column if not exists handoff_sequence integer not null default 1,
  add column if not exists progress integer not null default 0,
  add column if not exists completed_steps integer not null default 0,
  add column if not exists next_step text,
  add column if not exists waiting_until timestamptz,
  add column if not exists step_outcome text,
  add column if not exists returned_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists last_note_at timestamptz;

alter table public.assignments drop constraint if exists assignments_status_check;
alter table public.assignments add constraint assignments_status_check check (status in (
  'pending_acceptance','accepted','declined','clarification_requested',
  'alternative_date_proposed','in_progress','waiting','blocked','completed',
  'returned','closed','cancelled'
));
alter table public.assignments drop constraint if exists assignments_progress_check;
alter table public.assignments add constraint assignments_progress_check check (progress between 0 and 100);
alter table public.assignments drop constraint if exists assignments_completed_steps_check;
alter table public.assignments add constraint assignments_completed_steps_check check (completed_steps >= 0);
alter table public.assignments drop constraint if exists assignments_handoff_sequence_check;
alter table public.assignments add constraint assignments_handoff_sequence_check check (handoff_sequence > 0);
alter table public.assignments drop constraint if exists assignments_step_outcome_check;
alter table public.assignments add constraint assignments_step_outcome_check
  check (step_outcome is null or step_outcome in ('continue','returned','closed'));

drop index if exists public.assignments_active_unique;
create unique index assignments_active_unique
  on public.assignments(resource_type, resource_id, assigned_to_id)
  where status not in ('declined','completed','returned','closed','cancelled');
create index if not exists assignments_resource_chain_idx
  on public.assignments(resource_type, resource_id, handoff_sequence, created_at);
create index if not exists assignments_parent_idx
  on public.assignments(parent_assignment_id) where parent_assignment_id is not null;

create table if not exists public.task_handoff_notes (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null default 'comment',
  body text not null,
  progress integer,
  next_step text,
  waiting_until timestamptz,
  created_at timestamptz not null default now(),
  constraint task_handoff_notes_event_check check (event_type in (
    'assigned','accepted','declined','clarification','progress','waiting',
    'blocked','step_completed','returned','closed','comment'
  )),
  constraint task_handoff_notes_body_check check (char_length(btrim(body)) between 1 and 5000),
  constraint task_handoff_notes_progress_check check (progress is null or progress between 0 and 100)
);
create index if not exists task_handoff_notes_task_created_idx
  on public.task_handoff_notes(task_id, created_at desc);
create index if not exists task_handoff_notes_assignment_idx
  on public.task_handoff_notes(assignment_id, created_at);

alter table public.task_handoff_notes enable row level security;

drop policy if exists task_handoff_notes_select_participant on public.task_handoff_notes;
create policy task_handoff_notes_select_participant
on public.task_handoff_notes for select to authenticated
using (
  exists (
    select 1
    from public.assignments a
    where a.id = assignment_id
      and a.resource_type = 'task'
      and a.resource_id = task_id
      and (a.assigned_by_id = (select auth.uid()) or a.assigned_to_id = (select auth.uid()))
  )
  and (
    exists (select 1 from public.tasks t where t.id = task_id and t.owner_id = (select auth.uid()))
    or exists (
      select 1 from public.share_records s
      where s.resource_type = 'task' and s.resource_id = task_id
        and (s.owner_id = (select auth.uid()) or s.shared_with_user_id = (select auth.uid()))
        and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
    )
    or exists (
      select 1 from public.joint_memberships j
      where j.resource_type = 'task' and j.resource_id = task_id
        and (j.user_id = (select auth.uid()) or j.invited_by_id = (select auth.uid()))
        and j.accepted_at is not null and j.removed_at is null
    )
  )
);

drop policy if exists task_handoff_notes_insert_participant on public.task_handoff_notes;
create policy task_handoff_notes_insert_participant
on public.task_handoff_notes for insert to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1
    from public.assignments a
    where a.id = assignment_id
      and a.resource_type = 'task'
      and a.resource_id = task_id
      and (a.assigned_by_id = (select auth.uid()) or a.assigned_to_id = (select auth.uid()))
  )
);

revoke all on public.task_handoff_notes from public, anon, authenticated;
grant select, insert on public.task_handoff_notes to authenticated;

-- Let an assignee hand a live case back to the previous actor, or clear the
-- assignee only while explicitly closing the whole case.
create or replace function private.enforce_task_update_permission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := (select auth.uid());
  allowed_permission text;
  previous_actor uuid;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if actor = old.owner_id then return new; end if;
  select s.permission into allowed_permission
  from public.share_records s
  where s.resource_type = 'task' and s.resource_id = old.id
    and s.shared_with_user_id = actor and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
  order by s.created_at desc limit 1;
  select a.assigned_by_id into previous_actor
  from public.assignments a
  where a.resource_type = 'task' and a.resource_id = old.id
    and a.assigned_to_id = actor
    and a.status in ('accepted','in_progress','waiting','blocked')
  order by a.created_at desc limit 1;
  if allowed_permission is null and previous_actor is not null
  then allowed_permission := 'update_status'; end if;
  if allowed_permission = 'co_owner' and exists (
    select 1 from public.joint_memberships j where j.resource_type = 'task' and j.resource_id = old.id
      and j.user_id = actor and j.accepted_at is not null and j.removed_at is null
  ) then return new; end if;
  if allowed_permission = 'edit' then
    if new.owner_id <> old.owner_id or new.user_id <> old.user_id or new.created_by_id <> old.created_by_id
       or new.visibility <> old.visibility then raise exception 'OWNER_FIELDS_IMMUTABLE'; end if;
    return new;
  end if;
  if allowed_permission = 'update_status'
    and (
      new.assignee_id is not distinct from old.assignee_id
      or new.assignee_id = actor
      or (new.assignee_id = previous_actor and new.status in ('in_progress','waiting'))
      or (new.assignee_id is null and new.status = 'done')
    )
    and (
      to_jsonb(new) - array[
        'status','progress','blocked_reason','completed_at','last_progress_at',
        'actual_minutes','updated_at','assignee_id'
      ]
      =
      to_jsonb(old) - array[
        'status','progress','blocked_reason','completed_at','last_progress_at',
        'actual_minutes','updated_at','assignee_id'
      ]
    )
  then return new; end if;
  raise exception 'TASK_UPDATE_FORBIDDEN';
end;
$$;
revoke all on function private.enforce_task_update_permission() from public, anon, authenticated;

create or replace function private.enforce_assignment_update_permission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if new.resource_type <> old.resource_type or new.resource_id <> old.resource_id
     or new.assigned_by_id <> old.assigned_by_id or new.assigned_to_id <> old.assigned_to_id
     or new.parent_assignment_id is distinct from old.parent_assignment_id
     or new.handoff_sequence <> old.handoff_sequence
  then raise exception 'ASSIGNMENT_IDENTITY_IMMUTABLE'; end if;
  if actor = old.assigned_by_id then return new; end if;
  if actor = old.assigned_to_id
    and new.status in (
      'accepted','declined','clarification_requested','alternative_date_proposed',
      'in_progress','waiting','blocked','completed','returned','closed'
    )
    and (
      to_jsonb(new) - array[
        'status','decline_reason','proposed_date','clarification_request',
        'accepted_at','declined_at','completed_at','updated_at','progress',
        'completed_steps','next_step','waiting_until','step_outcome',
        'returned_at','closed_at','last_note_at'
      ]
      =
      to_jsonb(old) - array[
        'status','decline_reason','proposed_date','clarification_request',
        'accepted_at','declined_at','completed_at','updated_at','progress',
        'completed_steps','next_step','waiting_until','step_outcome',
        'returned_at','closed_at','last_note_at'
      ]
    )
  then return new; end if;
  raise exception 'ASSIGNMENT_UPDATE_FORBIDDEN';
end;
$$;
revoke all on function private.enforce_assignment_update_permission() from public, anon, authenticated;

create or replace function public.start_task_handoff(
  p_task_id uuid,
  p_target_user_id uuid,
  p_note text,
  p_due_date date
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  new_assignment_id uuid;
  next_sequence integer;
  task_progress integer;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_target_user_id is null or p_target_user_id = actor then raise exception 'INVALID_HANDOFF_TARGET'; end if;
  if nullif(btrim(p_note), '') is null then raise exception 'HANDOFF_NOTE_REQUIRED'; end if;
  if not exists (
    select 1 from public.tasks t
    where t.id = p_task_id and t.owner_id = actor
      and t.deleted_at is null and t.archived_at is null
      and t.status not in ('done','cancelled')
  ) then raise exception 'TASK_HANDOFF_FORBIDDEN'; end if;
  if not exists (
    select 1 from public.participant_profiles() p where p.user_id = p_target_user_id
  ) then raise exception 'HANDOFF_TARGET_NOT_CONNECTED'; end if;
  if exists (
    select 1 from public.assignments a
    where a.resource_type = 'task' and a.resource_id = p_task_id
      and a.status in ('pending_acceptance','accepted','in_progress','waiting','blocked')
  ) then raise exception 'TASK_ALREADY_HANDED_OFF'; end if;

  select coalesce(t.progress, 0) into task_progress
  from public.tasks t where t.id = p_task_id for update;
  select coalesce(max(a.handoff_sequence), 0) + 1 into next_sequence
  from public.assignments a
  where a.resource_type = 'task' and a.resource_id = p_task_id;

  if not exists (
    select 1 from public.share_records s
    where s.resource_type = 'task' and s.resource_id = p_task_id
      and s.shared_with_user_id = p_target_user_id and s.revoked_at is null
  ) then
    insert into public.share_records(
      resource_type, resource_id, owner_id, shared_with_user_id,
      permission, share_type, include_comments
    ) values (
      'task', p_task_id, actor, p_target_user_id,
      'update_status', 'assignment', true
    );
  end if;

  insert into public.assignments(
    resource_type, resource_id, assigned_by_id, assigned_to_id,
    status, due_date, instructions, progress, handoff_sequence, last_note_at
  ) values (
    'task', p_task_id, actor, p_target_user_id,
    'pending_acceptance', p_due_date, left(btrim(p_note), 5000),
    task_progress, next_sequence, now()
  ) returning id into new_assignment_id;

  insert into public.task_handoff_notes(
    assignment_id, task_id, author_id, event_type, body, progress
  ) values (
    new_assignment_id, p_task_id, actor, 'assigned',
    left(btrim(p_note), 5000), task_progress
  );
  update public.tasks
  set visibility = 'assigned', last_progress_at = now()
  where id = p_task_id;
  return new_assignment_id;
end;
$$;

create or replace function public.record_task_handoff_progress(
  p_assignment_id uuid,
  p_status text,
  p_progress integer,
  p_note text,
  p_next_step text,
  p_waiting_until timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  current_assignment public.assignments%rowtype;
  note_event text;
  task_status text;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_status not in ('in_progress','waiting','blocked') then raise exception 'INVALID_HANDOFF_STATUS'; end if;
  if p_progress is null or p_progress < 0 or p_progress > 100 then raise exception 'INVALID_HANDOFF_PROGRESS'; end if;
  if nullif(btrim(p_note), '') is null then raise exception 'HANDOFF_NOTE_REQUIRED'; end if;

  select * into current_assignment
  from public.assignments a
  where a.id = p_assignment_id and a.resource_type = 'task'
    and a.assigned_to_id = actor
    and a.status in ('accepted','in_progress','waiting','blocked')
  for update;
  if not found then raise exception 'HANDOFF_UPDATE_FORBIDDEN'; end if;

  note_event := case p_status when 'waiting' then 'waiting' when 'blocked' then 'blocked' else 'progress' end;
  task_status := case p_status when 'waiting' then 'waiting' when 'blocked' then 'blocked' else 'in_progress' end;
  update public.tasks
  set status = task_status,
      progress = p_progress,
      blocked_reason = case when p_status = 'blocked' then left(btrim(p_note), 5000) else null end,
      last_progress_at = now()
  where id = current_assignment.resource_id;

  update public.assignments
  set status = p_status,
      progress = p_progress,
      next_step = nullif(left(btrim(p_next_step), 5000), ''),
      waiting_until = p_waiting_until,
      last_note_at = now(),
      updated_at = now()
  where id = current_assignment.id;

  insert into public.task_handoff_notes(
    assignment_id, task_id, author_id, event_type, body,
    progress, next_step, waiting_until
  ) values (
    current_assignment.id, current_assignment.resource_id, actor, note_event,
    left(btrim(p_note), 5000), p_progress,
    nullif(left(btrim(p_next_step), 5000), ''), p_waiting_until
  );
  return current_assignment.id;
end;
$$;

create or replace function public.resolve_task_handoff_step(
  p_assignment_id uuid,
  p_resolution text,
  p_note text,
  p_next_step text,
  p_waiting_until timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  current_assignment public.assignments%rowtype;
  new_assignment_id uuid;
  current_progress integer;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_resolution not in ('continue','return','close') then raise exception 'INVALID_HANDOFF_RESOLUTION'; end if;
  if nullif(btrim(p_note), '') is null then raise exception 'HANDOFF_NOTE_REQUIRED'; end if;

  select * into current_assignment
  from public.assignments a
  where a.id = p_assignment_id and a.resource_type = 'task'
    and a.assigned_to_id = actor
    and a.status in ('accepted','in_progress','waiting','blocked')
  for update;
  if not found then raise exception 'HANDOFF_RESOLUTION_FORBIDDEN'; end if;
  select coalesce(t.progress, current_assignment.progress, 0) into current_progress
  from public.tasks t where t.id = current_assignment.resource_id for update;

  if p_resolution = 'continue' then
    update public.tasks
    set status = case when p_waiting_until is null then 'in_progress' else 'waiting' end,
        blocked_reason = null,
        last_progress_at = now()
    where id = current_assignment.resource_id;
    update public.assignments
    set status = case when p_waiting_until is null then 'in_progress' else 'waiting' end,
        completed_steps = completed_steps + 1,
        step_outcome = 'continue',
        next_step = nullif(left(btrim(p_next_step), 5000), ''),
        waiting_until = p_waiting_until,
        last_note_at = now(),
        updated_at = now()
    where id = current_assignment.id;
    insert into public.task_handoff_notes(
      assignment_id, task_id, author_id, event_type, body,
      progress, next_step, waiting_until
    ) values (
      current_assignment.id, current_assignment.resource_id, actor, 'step_completed',
      left(btrim(p_note), 5000), current_progress,
      nullif(left(btrim(p_next_step), 5000), ''), p_waiting_until
    );
    return current_assignment.id;
  end if;

  if p_resolution = 'return' then
    -- Update the task while the current assignment is still active so the
    -- field-level permission trigger can verify the previous actor.
    update public.tasks
    set assignee_id = current_assignment.assigned_by_id,
        status = 'in_progress',
        blocked_reason = null,
        last_progress_at = now()
    where id = current_assignment.resource_id;
    update public.assignments
    set status = 'returned',
        completed_steps = completed_steps + 1,
        step_outcome = 'returned',
        next_step = nullif(left(btrim(p_next_step), 5000), ''),
        waiting_until = p_waiting_until,
        completed_at = now(),
        returned_at = now(),
        last_note_at = now(),
        updated_at = now()
    where id = current_assignment.id;
    insert into public.assignments(
      resource_type, resource_id, assigned_by_id, assigned_to_id,
      status, due_date, requested_priority, definition_of_done,
      instructions, accepted_at, parent_assignment_id, handoff_sequence,
      progress, next_step, waiting_until, last_note_at
    ) values (
      'task', current_assignment.resource_id, actor, current_assignment.assigned_by_id,
      'in_progress', current_assignment.due_date, current_assignment.requested_priority,
      current_assignment.definition_of_done, left(btrim(p_note), 5000), now(),
      current_assignment.id, current_assignment.handoff_sequence + 1,
      current_progress, nullif(left(btrim(p_next_step), 5000), ''),
      p_waiting_until, now()
    ) returning id into new_assignment_id;
    insert into public.task_handoff_notes(
      assignment_id, task_id, author_id, event_type, body,
      progress, next_step, waiting_until
    ) values (
      current_assignment.id, current_assignment.resource_id, actor, 'returned',
      left(btrim(p_note), 5000), current_progress,
      nullif(left(btrim(p_next_step), 5000), ''), p_waiting_until
    );
    return new_assignment_id;
  end if;

  update public.tasks
  set assignee_id = null,
      status = 'done',
      progress = 100,
      blocked_reason = null,
      completed_at = now(),
      last_progress_at = now()
  where id = current_assignment.resource_id;
  update public.assignments
  set status = 'closed',
      progress = 100,
      completed_steps = completed_steps + 1,
      step_outcome = 'closed',
      next_step = null,
      waiting_until = null,
      completed_at = now(),
      closed_at = now(),
      last_note_at = now(),
      updated_at = now()
  where id = current_assignment.id;
  insert into public.task_handoff_notes(
    assignment_id, task_id, author_id, event_type, body, progress
  ) values (
    current_assignment.id, current_assignment.resource_id, actor, 'closed',
    left(btrim(p_note), 5000), 100
  );
  return current_assignment.id;
end;
$$;

revoke all on function public.start_task_handoff(uuid, uuid, text, date) from public, anon;
revoke all on function public.record_task_handoff_progress(uuid, text, integer, text, text, timestamptz) from public, anon;
revoke all on function public.resolve_task_handoff_step(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.start_task_handoff(uuid, uuid, text, date) to authenticated;
grant execute on function public.record_task_handoff_progress(uuid, text, integer, text, text, timestamptz) to authenticated;
grant execute on function public.resolve_task_handoff_step(uuid, text, text, text, timestamptz) to authenticated;
