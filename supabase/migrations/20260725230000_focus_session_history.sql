-- Persistent personal Focus history. Sessions improve restart and time estimates;
-- they are never shared as productivity comparisons.

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_session_id uuid not null,
  planned_minutes integer not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  paused_at timestamptz,
  paused_seconds integer not null default 0,
  actual_minutes integer,
  interruption_count integer not null default 0,
  checkpoint_id uuid references public.task_checkpoints(id) on delete set null,
  block_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint focus_sessions_user_client_unique unique(user_id, client_session_id),
  constraint focus_sessions_planned_check check (planned_minutes in (15, 25, 45)),
  constraint focus_sessions_status_check check (status in ('running', 'paused', 'completed', 'partial', 'interrupted')),
  constraint focus_sessions_pause_check check (paused_seconds between 0 and 31536000),
  constraint focus_sessions_actual_check check (actual_minutes is null or actual_minutes between 1 and 14400),
  constraint focus_sessions_interruptions_check check (interruption_count between 0 and 1000),
  constraint focus_sessions_block_reason_check check (block_reason is null or char_length(block_reason) <= 2000),
  constraint focus_sessions_timing_check check (
    (status in ('running', 'paused') and ended_at is null)
    or (status in ('completed', 'partial', 'interrupted') and ended_at is not null and actual_minutes is not null)
  )
);

create index if not exists focus_sessions_user_task_started_idx
  on public.focus_sessions(user_id, task_id, started_at desc);
create index if not exists focus_sessions_user_status_idx
  on public.focus_sessions(user_id, status, started_at desc);

alter table public.focus_sessions enable row level security;

drop policy if exists focus_sessions_select_self on public.focus_sessions;
create policy focus_sessions_select_self
on public.focus_sessions for select to authenticated
using (user_id = (select auth.uid()));

revoke all on public.focus_sessions from public, anon, authenticated;
grant select on public.focus_sessions to authenticated;

create or replace function public.start_focus_session(
  p_client_session_id uuid,
  p_task_id uuid,
  p_planned_minutes integer
)
returns public.focus_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  session public.focus_sessions;
  current_pause_seconds integer;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_client_session_id is null or p_task_id is null or p_planned_minutes not in (15, 25, 45) then
    raise exception 'FOCUS_SESSION_INPUT_INVALID';
  end if;
  if not (select private.current_user_can_checkpoint(p_task_id)) then
    raise exception 'FOCUS_SESSION_FORBIDDEN';
  end if;

  select * into session
  from public.focus_sessions
  where user_id = actor and client_session_id = p_client_session_id
  for update;
  if session.id is not null then return session; end if;

  update public.focus_sessions s
  set status = 'interrupted',
      ended_at = now(),
      interruption_count = least(1000, s.interruption_count + 1),
      paused_seconds = s.paused_seconds + case when s.paused_at is null then 0 else ceil(extract(epoch from now() - s.paused_at))::integer end,
      actual_minutes = least(14400, greatest(1, ceil(greatest(0, extract(epoch from now() - s.started_at) - s.paused_seconds - coalesce(extract(epoch from now() - s.paused_at), 0)) / 60.0)::integer)),
      paused_at = null,
      updated_at = now()
  where s.user_id = actor and s.status in ('running', 'paused');

  insert into public.focus_sessions(task_id, user_id, client_session_id, planned_minutes)
  values (p_task_id, actor, p_client_session_id, p_planned_minutes)
  returning * into session;
  return session;
end;
$$;

create or replace function public.pause_focus_session(p_session_id uuid)
returns public.focus_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  session public.focus_sessions;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null then raise exception 'FOCUS_SESSION_INPUT_INVALID'; end if;
  update public.focus_sessions
  set status = 'paused', paused_at = coalesce(paused_at, now()), updated_at = now()
  where id = p_session_id and user_id = actor and status = 'running'
  returning * into session;
  if session.id is null then
    select * into session from public.focus_sessions where id = p_session_id and user_id = actor;
    if session.id is null then raise exception 'FOCUS_SESSION_FORBIDDEN'; end if;
  end if;
  return session;
end;
$$;

create or replace function public.resume_focus_session(p_session_id uuid)
returns public.focus_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  session public.focus_sessions;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null then raise exception 'FOCUS_SESSION_INPUT_INVALID'; end if;
  update public.focus_sessions
  set status = 'running',
      paused_seconds = paused_seconds + case when paused_at is null then 0 else ceil(extract(epoch from now() - paused_at))::integer end,
      paused_at = null,
      updated_at = now()
  where id = p_session_id and user_id = actor and status = 'paused'
  returning * into session;
  if session.id is null then
    select * into session from public.focus_sessions where id = p_session_id and user_id = actor;
    if session.id is null then raise exception 'FOCUS_SESSION_FORBIDDEN'; end if;
  end if;
  return session;
end;
$$;

create or replace function public.finish_focus_session(
  p_session_id uuid,
  p_status text,
  p_checkpoint_id uuid default null,
  p_block_reason text default null
)
returns public.focus_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  session public.focus_sessions;
  checkpoint_task_id uuid;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_status not in ('completed', 'partial', 'interrupted') then
    raise exception 'FOCUS_SESSION_INPUT_INVALID';
  end if;
  if p_block_reason is not null and char_length(btrim(p_block_reason)) > 2000 then
    raise exception 'FOCUS_SESSION_INPUT_INVALID';
  end if;

  select * into session from public.focus_sessions
  where id = p_session_id and user_id = actor
  for update;
  if session.id is null then raise exception 'FOCUS_SESSION_FORBIDDEN'; end if;
  if session.status in ('completed', 'partial', 'interrupted') then return session; end if;

  if p_checkpoint_id is not null then
    select task_id into checkpoint_task_id
    from public.task_checkpoints
    where id = p_checkpoint_id and task_id = session.task_id and author_id = actor and state = 'saved';
    if checkpoint_task_id is null then raise exception 'FOCUS_SESSION_CHECKPOINT_INVALID'; end if;
  end if;

  update public.focus_sessions s
  set status = p_status,
      ended_at = now(),
      paused_seconds = s.paused_seconds + case when s.paused_at is null then 0 else ceil(extract(epoch from now() - s.paused_at))::integer end,
      actual_minutes = least(14400, greatest(1, ceil(greatest(0, extract(epoch from now() - s.started_at) - s.paused_seconds - coalesce(extract(epoch from now() - s.paused_at), 0)) / 60.0)::integer)),
      checkpoint_id = coalesce(p_checkpoint_id, s.checkpoint_id),
      block_reason = case when p_status = 'interrupted' then nullif(btrim(coalesce(p_block_reason, '')), '') else s.block_reason end,
      interruption_count = case when p_status = 'interrupted' then least(1000, s.interruption_count + 1) else s.interruption_count end,
      paused_at = null,
      updated_at = now()
  where s.id = session.id
  returning * into session;
  return session;
end;
$$;

revoke all on function public.start_focus_session(uuid, uuid, integer) from public, anon;
revoke all on function public.pause_focus_session(uuid) from public, anon;
revoke all on function public.resume_focus_session(uuid) from public, anon;
revoke all on function public.finish_focus_session(uuid, text, uuid, text) from public, anon;
grant execute on function public.start_focus_session(uuid, uuid, integer) to authenticated;
grant execute on function public.pause_focus_session(uuid) to authenticated;
grant execute on function public.resume_focus_session(uuid) to authenticated;
grant execute on function public.finish_focus_session(uuid, text, uuid, text) to authenticated;

comment on table public.focus_sessions is
  'Private Focus timing history for restart and time estimation; not a performance comparison.';
