-- Durable two-person body-double focus sessions.
-- This is additive: it does not change tasks, sharing, assignments, or checkpoints.

create table if not exists public.body_double_sessions (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null references auth.users(id) on delete cascade,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  duration_minutes integer not null,
  status text not null default 'waiting',
  started_at timestamptz,
  ended_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint body_double_sessions_not_self check (created_by_id <> invited_user_id),
  constraint body_double_sessions_duration_check check (duration_minutes in (15, 20, 25, 45)),
  constraint body_double_sessions_status_check check (status in ('waiting', 'running', 'ended', 'cancelled')),
  constraint body_double_sessions_time_check check (
    (status = 'waiting' and started_at is null and ended_at is null and cancelled_at is null)
    or (status = 'running' and started_at is not null and ended_at is null and cancelled_at is null)
    or (status = 'ended' and started_at is not null and ended_at is not null and cancelled_at is null)
    or (status = 'cancelled' and started_at is null and ended_at is null and cancelled_at is not null)
  )
);

create table if not exists public.body_double_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.body_double_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  task_label text,
  share_task_title boolean not null default false,
  status text not null default 'invited',
  ready_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  checkpoint_saved_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint body_double_participants_session_user_unique unique (session_id, user_id),
  constraint body_double_participants_status_check check (status in ('invited', 'ready', 'running', 'paused', 'completed', 'left')),
  constraint body_double_participants_task_label_check check (task_label is null or char_length(btrim(task_label)) between 1 and 500),
  constraint body_double_participants_ready_check check (
    (status = 'invited' and task_id is null and task_label is null and ready_at is null)
    or (status in ('ready', 'running', 'paused', 'completed', 'left') and task_id is not null and task_label is not null and ready_at is not null)
  )
);

create unique index if not exists body_double_open_pair_unique
  on public.body_double_sessions (
    least(created_by_id, invited_user_id),
    greatest(created_by_id, invited_user_id)
  )
  where status in ('waiting', 'running');
create index if not exists body_double_sessions_invited_active_idx
  on public.body_double_sessions(invited_user_id, created_at desc)
  where status in ('waiting', 'running');
create index if not exists body_double_participants_session_idx
  on public.body_double_participants(session_id, updated_at desc);
create index if not exists body_double_participants_user_active_idx
  on public.body_double_participants(user_id, updated_at desc);

create or replace function private.body_double_can_access_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.body_double_sessions s
    where s.id = p_session_id
      and ((select auth.uid()) = s.created_by_id or (select auth.uid()) = s.invited_user_id)
  );
$$;
revoke all on function private.body_double_can_access_session(uuid) from public, anon;
grant execute on function private.body_double_can_access_session(uuid) to authenticated;

create or replace function private.touch_body_double_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_body_double_updated_at() from public, anon, authenticated;

drop trigger if exists touch_body_double_sessions_updated_at on public.body_double_sessions;
create trigger touch_body_double_sessions_updated_at
before update on public.body_double_sessions
for each row execute function private.touch_body_double_updated_at();

drop trigger if exists touch_body_double_participants_updated_at on public.body_double_participants;
create trigger touch_body_double_participants_updated_at
before update on public.body_double_participants
for each row execute function private.touch_body_double_updated_at();

alter table public.body_double_sessions enable row level security;
alter table public.body_double_participants enable row level security;

drop policy if exists body_double_sessions_select_participant on public.body_double_sessions;
create policy body_double_sessions_select_participant
on public.body_double_sessions for select to authenticated
using (private.body_double_can_access_session(id));

drop policy if exists body_double_participants_select_session_participant on public.body_double_participants;
create policy body_double_participants_select_session_participant
on public.body_double_participants for select to authenticated
using (private.body_double_can_access_session(session_id));

revoke all on public.body_double_sessions, public.body_double_participants from public, anon, authenticated;
grant select on public.body_double_sessions, public.body_double_participants to authenticated;

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

create or replace function public.start_body_double_session(p_session_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  session_status text;
  start_time timestamptz;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or not private.body_double_can_access_session(p_session_id) then raise exception 'BODY_DOUBLE_SESSION_FORBIDDEN'; end if;
  select status, started_at into session_status, start_time
  from public.body_double_sessions where id = p_session_id for update;
  if session_status = 'running' then return start_time; end if;
  if session_status is distinct from 'waiting' then raise exception 'BODY_DOUBLE_SESSION_NOT_READY'; end if;
  if (select count(*) from public.body_double_participants
      where session_id = p_session_id and status = 'ready' and task_id is not null) <> 2 then
    raise exception 'BODY_DOUBLE_PARTICIPANTS_NOT_READY';
  end if;
  start_time := now();
  update public.body_double_sessions set status = 'running', started_at = start_time where id = p_session_id;
  update public.body_double_participants
  set status = 'running', paused_at = null, last_seen_at = start_time
  where session_id = p_session_id and status = 'ready';
  return start_time;
end;
$$;

create or replace function public.update_body_double_presence(
  p_session_id uuid,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  session_status text;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_status not in ('running', 'paused', 'left') then raise exception 'BODY_DOUBLE_PRESENCE_INVALID'; end if;
  if p_session_id is null or not private.body_double_can_access_session(p_session_id) then raise exception 'BODY_DOUBLE_SESSION_FORBIDDEN'; end if;
  select status into session_status from public.body_double_sessions where id = p_session_id for update;
  if session_status is distinct from 'running' then raise exception 'BODY_DOUBLE_SESSION_NOT_RUNNING'; end if;
  update public.body_double_participants
  set status = p_status,
      paused_at = case when p_status = 'paused' then now() else null end,
      last_seen_at = now()
  where session_id = p_session_id and user_id = actor
    and status not in ('completed', 'left');
  if not found then raise exception 'BODY_DOUBLE_PARTICIPANT_FINISHED'; end if;
  return p_session_id;
end;
$$;

create or replace function public.heartbeat_body_double_session(p_session_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or not private.body_double_can_access_session(p_session_id) then raise exception 'BODY_DOUBLE_SESSION_FORBIDDEN'; end if;
  update public.body_double_participants
  set last_seen_at = now()
  where session_id = p_session_id and user_id = actor and status not in ('completed', 'left');
  if not found then raise exception 'BODY_DOUBLE_PARTICIPANT_FINISHED'; end if;
  return now();
end;
$$;

create or replace function public.complete_body_double_participant(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  selected_task_id uuid;
  session_started_at timestamptz;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or not private.body_double_can_access_session(p_session_id) then raise exception 'BODY_DOUBLE_SESSION_FORBIDDEN'; end if;
  select started_at into session_started_at
  from public.body_double_sessions where id = p_session_id and status = 'running' for update;
  if session_started_at is null then raise exception 'BODY_DOUBLE_SESSION_NOT_RUNNING'; end if;
  select task_id into selected_task_id
  from public.body_double_participants
  where session_id = p_session_id and user_id = actor and status not in ('completed', 'left')
  for update;
  if selected_task_id is null then raise exception 'BODY_DOUBLE_PARTICIPANT_FINISHED'; end if;
  if not exists (
    select 1 from public.task_checkpoints c
    where c.task_id = selected_task_id and c.author_id = actor and c.state = 'saved'
      and c.created_at >= session_started_at
  ) then
    raise exception 'BODY_DOUBLE_CHECKPOINT_REQUIRED';
  end if;
  update public.body_double_participants
  set status = 'completed', completed_at = now(), checkpoint_saved_at = now(), last_seen_at = now()
  where session_id = p_session_id and user_id = actor;
  if not exists (
    select 1 from public.body_double_participants
    where session_id = p_session_id and status not in ('completed', 'left')
  ) then
    update public.body_double_sessions set status = 'ended', ended_at = now() where id = p_session_id;
  end if;
  return p_session_id;
end;
$$;

create or replace function public.cancel_body_double_session(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.body_double_sessions
  set status = 'cancelled', cancelled_at = now()
  where id = p_session_id and created_by_id = actor and status = 'waiting';
  if not found then raise exception 'BODY_DOUBLE_CANCEL_FORBIDDEN'; end if;
  return p_session_id;
end;
$$;

revoke all on function public.create_body_double_session(uuid, uuid, integer, boolean) from public, anon;
revoke all on function public.prepare_body_double_participant(uuid, uuid, boolean) from public, anon;
revoke all on function public.start_body_double_session(uuid) from public, anon;
revoke all on function public.update_body_double_presence(uuid, text) from public, anon;
revoke all on function public.heartbeat_body_double_session(uuid) from public, anon;
revoke all on function public.complete_body_double_participant(uuid) from public, anon;
revoke all on function public.cancel_body_double_session(uuid) from public, anon;
grant execute on function public.create_body_double_session(uuid, uuid, integer, boolean) to authenticated;
grant execute on function public.prepare_body_double_participant(uuid, uuid, boolean) to authenticated;
grant execute on function public.start_body_double_session(uuid) to authenticated;
grant execute on function public.update_body_double_presence(uuid, text) to authenticated;
grant execute on function public.heartbeat_body_double_session(uuid) to authenticated;
grant execute on function public.complete_body_double_participant(uuid) to authenticated;
grant execute on function public.cancel_body_double_session(uuid) to authenticated;
