-- Roll back the continuous handoff workflow without deleting tasks or legacy assignments.
drop function if exists public.resolve_task_handoff_step(uuid, text, text, text, timestamptz);
drop function if exists public.record_task_handoff_progress(uuid, text, integer, text, text, timestamptz);
drop function if exists public.start_task_handoff(uuid, uuid, text, date);
drop table if exists public.task_handoff_notes;

drop index if exists public.assignments_parent_idx;
drop index if exists public.assignments_resource_chain_idx;
drop index if exists public.assignments_active_unique;
update public.assignments
set status = case
  when status = 'waiting' then 'in_progress'
  when status in ('returned','closed') then 'completed'
  else status
end
where status in ('waiting','returned','closed');
create unique index assignments_active_unique
  on public.assignments(resource_type, resource_id, assigned_to_id)
  where status not in ('declined','completed','cancelled');

alter table public.assignments drop constraint if exists assignments_step_outcome_check;
alter table public.assignments drop constraint if exists assignments_handoff_sequence_check;
alter table public.assignments drop constraint if exists assignments_completed_steps_check;
alter table public.assignments drop constraint if exists assignments_progress_check;
alter table public.assignments drop constraint if exists assignments_status_check;
alter table public.assignments add constraint assignments_status_check check (status in (
  'pending_acceptance','accepted','declined','clarification_requested',
  'alternative_date_proposed','in_progress','blocked','completed','cancelled'
));

alter table public.assignments
  drop column if exists last_note_at,
  drop column if exists closed_at,
  drop column if exists returned_at,
  drop column if exists step_outcome,
  drop column if exists waiting_until,
  drop column if exists next_step,
  drop column if exists completed_steps,
  drop column if exists progress,
  drop column if exists handoff_sequence,
  drop column if exists parent_assignment_id;

create or replace function private.enforce_task_update_permission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := (select auth.uid());
  allowed_permission text;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if actor = old.owner_id then return new; end if;
  select s.permission into allowed_permission
  from public.share_records s
  where s.resource_type = 'task' and s.resource_id = old.id
    and s.shared_with_user_id = actor and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
  order by s.created_at desc limit 1;
  if allowed_permission is null and exists (
    select 1 from public.assignments a where a.resource_type = 'task' and a.resource_id = old.id
      and a.assigned_to_id = actor and a.status in ('accepted','in_progress','blocked')
  ) then allowed_permission := 'update_status'; end if;
  if allowed_permission = 'co_owner' and exists (
    select 1 from public.joint_memberships j where j.resource_type = 'task' and j.resource_id = old.id
      and j.user_id = actor and j.accepted_at is not null and j.removed_at is null
  ) then return new; end if;
  if allowed_permission = 'edit' then
    if new.owner_id <> old.owner_id or new.user_id <> old.user_id or new.created_by_id <> old.created_by_id
       or new.visibility <> old.visibility then raise exception 'OWNER_FIELDS_IMMUTABLE'; end if;
    return new;
  end if;
  if allowed_permission = 'update_status' and
     (new.assignee_id is not distinct from old.assignee_id or new.assignee_id = actor) and
     (to_jsonb(new) - array['status','progress','blocked_reason','completed_at','last_progress_at','actual_minutes','updated_at','assignee_id']) =
     (to_jsonb(old) - array['status','progress','blocked_reason','completed_at','last_progress_at','actual_minutes','updated_at','assignee_id'])
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
  then raise exception 'ASSIGNMENT_IDENTITY_IMMUTABLE'; end if;
  if actor = old.assigned_by_id then return new; end if;
  if actor = old.assigned_to_id
    and new.status in ('accepted','declined','clarification_requested','alternative_date_proposed','in_progress','blocked','completed')
    and (to_jsonb(new) - array['status','decline_reason','proposed_date','clarification_request','accepted_at','declined_at','completed_at','updated_at']) =
        (to_jsonb(old) - array['status','decline_reason','proposed_date','clarification_request','accepted_at','declined_at','completed_at','updated_at'])
  then return new; end if;
  raise exception 'ASSIGNMENT_UPDATE_FORBIDDEN';
end;
$$;
revoke all on function private.enforce_assignment_update_permission() from public, anon, authenticated;

-- The rollback intentionally preserves all task and legacy assignment rows so
-- no case is destroyed.
