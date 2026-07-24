-- Revert the Body Double eligible-task selector. Existing Body Double sessions remain untouched.

revoke all on function public.body_double_available_tasks() from public, anon, authenticated;
drop function if exists public.body_double_available_tasks();

create or replace function public.create_body_double_session(
  p_partner_user_id uuid,
  p_task_id uuid,
  p_duration_minutes integer,
  p_share_task_title boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  new_session_id uuid;
  selected_task_title text;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_partner_user_id is null or p_partner_user_id = actor then raise exception 'BODY_DOUBLE_TARGET_INVALID'; end if;
  if p_duration_minutes not in (15, 20, 25, 45) then raise exception 'BODY_DOUBLE_DURATION_INVALID'; end if;
  if not exists (select 1 from public.participant_profiles() p where p.user_id = p_partner_user_id) then
    raise exception 'BODY_DOUBLE_TARGET_NOT_CONNECTED';
  end if;
  if p_task_id is null or not private.current_user_can_read('task', p_task_id) then
    raise exception 'BODY_DOUBLE_TASK_FORBIDDEN';
  end if;
  select t.title into selected_task_title
  from public.tasks t
  where t.id = p_task_id and t.deleted_at is null and t.archived_at is null
    and t.status not in ('done', 'cancelled');
  if selected_task_title is null then raise exception 'BODY_DOUBLE_TASK_FORBIDDEN'; end if;
  begin
    insert into public.body_double_sessions(created_by_id, invited_user_id, duration_minutes)
    values (actor, p_partner_user_id, p_duration_minutes)
    returning id into new_session_id;
  exception when unique_violation then
    raise exception 'BODY_DOUBLE_ACTIVE_SESSION_EXISTS';
  end;
  insert into public.body_double_participants(
    session_id, user_id, task_id, task_label, share_task_title, status, ready_at, last_seen_at
  ) values (
    new_session_id, actor, p_task_id, left(btrim(selected_task_title), 500), coalesce(p_share_task_title, false),
    'ready', now(), now()
  ), (
    new_session_id, p_partner_user_id, null, null, false, 'invited', null, null
  );
  return new_session_id;
end;
$$;

create or replace function public.prepare_body_double_participant(
  p_session_id uuid,
  p_task_id uuid,
  p_share_task_title boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  selected_task_title text;
  session_status text;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or not private.body_double_can_access_session(p_session_id) then raise exception 'BODY_DOUBLE_SESSION_FORBIDDEN'; end if;
  select status into session_status from public.body_double_sessions where id = p_session_id for update;
  if session_status is distinct from 'waiting' then raise exception 'BODY_DOUBLE_SESSION_NOT_READY'; end if;
  if p_task_id is null or not private.current_user_can_read('task', p_task_id) then raise exception 'BODY_DOUBLE_TASK_FORBIDDEN'; end if;
  select t.title into selected_task_title
  from public.tasks t
  where t.id = p_task_id and t.deleted_at is null and t.archived_at is null
    and t.status not in ('done', 'cancelled');
  if selected_task_title is null then raise exception 'BODY_DOUBLE_TASK_FORBIDDEN'; end if;
  update public.body_double_participants
  set task_id = p_task_id,
      task_label = left(btrim(selected_task_title), 500),
      share_task_title = coalesce(p_share_task_title, false),
      status = 'ready',
      ready_at = now(),
      last_seen_at = now()
  where session_id = p_session_id and user_id = actor;
  if not found then raise exception 'BODY_DOUBLE_SESSION_FORBIDDEN'; end if;
  return p_session_id;
end;
$$;

revoke all on function public.create_body_double_session(uuid, uuid, integer, boolean) from public, anon;
revoke all on function public.prepare_body_double_participant(uuid, uuid, boolean) from public, anon;
grant execute on function public.create_body_double_session(uuid, uuid, integer, boolean) to authenticated;
grant execute on function public.prepare_body_double_participant(uuid, uuid, boolean) to authenticated;
