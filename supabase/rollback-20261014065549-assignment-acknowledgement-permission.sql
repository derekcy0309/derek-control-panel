-- Restores the pre-fix guard, without deleting any acknowledgement or task.
-- Warning: the original recipient acknowledgement bug returns after rollback.
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
