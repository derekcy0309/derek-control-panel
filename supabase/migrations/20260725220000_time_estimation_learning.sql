-- Personal time-estimation learning. Observations are per worker, never shared
-- between Derek and Suki, and are captured only from a user's explicit task-time update.

create table if not exists public.task_time_observations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_owner_id uuid not null references auth.users(id) on delete cascade,
  task_type text not null,
  task_context text,
  energy_level text,
  estimated_minutes integer not null,
  actual_minutes integer not null,
  outcome text not null,
  interruption_count integer not null default 0,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_time_observations_task_user_unique unique(task_id, user_id),
  constraint task_time_observations_type_check check (task_type in ('meeting_action', 'deadline', 'follow_up')),
  constraint task_time_observations_context_check check (task_context is null or task_context in ('mobile', 'computer', 'home', 'office', 'phone', 'night_shift')),
  constraint task_time_observations_energy_check check (energy_level is null or energy_level in ('low', 'medium', 'high')),
  constraint task_time_observations_estimated_check check (estimated_minutes between 1 and 14400),
  constraint task_time_observations_actual_check check (actual_minutes between 1 and 14400),
  constraint task_time_observations_outcome_check check (outcome in ('completed', 'paused')),
  constraint task_time_observations_interruptions_check check (interruption_count between 0 and 1000)
);

create index if not exists task_time_observations_user_type_idx
  on public.task_time_observations(user_id, task_type, recorded_at desc);
create index if not exists task_time_observations_user_context_energy_idx
  on public.task_time_observations(user_id, task_type, task_context, energy_level, recorded_at desc);

alter table public.task_time_observations enable row level security;

drop policy if exists task_time_observations_select_self on public.task_time_observations;
create policy task_time_observations_select_self
on public.task_time_observations for select to authenticated
using (user_id = (select auth.uid()));

revoke all on public.task_time_observations from public, anon, authenticated;
grant select on public.task_time_observations to authenticated;

create or replace function public.capture_task_time_observation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
begin
  if new.owner_id is null
     or new.estimated_minutes is null
     or new.actual_minutes is null
     or new.estimated_minutes < 1
     or new.actual_minutes < 1 then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.estimated_minutes is not distinct from old.estimated_minutes
     and new.actual_minutes is not distinct from old.actual_minutes
     and new.status is not distinct from old.status
     and new.source_type is not distinct from old.source_type
     and new.context is not distinct from old.context
     and new.energy_level is not distinct from old.energy_level then
    return new;
  end if;

  actor := coalesce(actor, new.owner_id);
  insert into public.task_time_observations (
    task_id, user_id, task_owner_id, task_type, task_context, energy_level,
    estimated_minutes, actual_minutes, outcome, recorded_at, updated_at
  ) values (
    new.id, actor, new.owner_id, new.source_type, new.context, new.energy_level,
    new.estimated_minutes, new.actual_minutes,
    case when new.status = 'done' then 'completed' else 'paused' end,
    now(), now()
  )
  on conflict (task_id, user_id) do update
  set task_owner_id = excluded.task_owner_id,
      task_type = excluded.task_type,
      task_context = excluded.task_context,
      energy_level = excluded.energy_level,
      estimated_minutes = excluded.estimated_minutes,
      actual_minutes = excluded.actual_minutes,
      outcome = excluded.outcome,
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists capture_task_time_observation on public.tasks;
create trigger capture_task_time_observation
after insert or update of owner_id, source_type, context, energy_level, estimated_minutes, actual_minutes, status
on public.tasks
for each row execute function public.capture_task_time_observation();

-- Historical task rows have no contributor identity, so they are attributed to
-- the task owner only. New updates are attributed to the actual logged-in worker.
insert into public.task_time_observations (
  task_id, user_id, task_owner_id, task_type, task_context, energy_level,
  estimated_minutes, actual_minutes, outcome, recorded_at, updated_at
)
select
  t.id, t.owner_id, t.owner_id, t.source_type, t.context, t.energy_level,
  t.estimated_minutes, t.actual_minutes,
  case when t.status = 'done' then 'completed' else 'paused' end,
  coalesce(t.completed_at, t.updated_at, now()), now()
from public.tasks t
where t.owner_id is not null
  and t.estimated_minutes between 1 and 14400
  and t.actual_minutes between 1 and 14400
on conflict (task_id, user_id) do nothing;

create or replace function public.time_estimate_suggestion(
  p_task_type text,
  p_context text,
  p_energy_level text,
  p_estimated_minutes integer
)
returns table (
  suggested_minutes integer,
  sample_count integer,
  median_multiplier numeric,
  basis text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_task_type not in ('meeting_action', 'deadline', 'follow_up')
     or p_context not in ('mobile', 'computer', 'home', 'office', 'phone', 'night_shift')
     or p_energy_level not in ('low', 'medium', 'high')
     or p_estimated_minutes not between 1 and 14400 then
    raise exception 'TIME_ESTIMATE_INPUT_INVALID';
  end if;

  return query
  with candidates as (
    select 1 as priority, '同類型、情境及能量'::text as candidate_basis,
      least(4::numeric, greatest(0.25::numeric, o.actual_minutes::numeric / o.estimated_minutes::numeric)) as ratio
    from public.task_time_observations o
    where o.user_id = actor and o.task_type = p_task_type
      and o.task_context = p_context and o.energy_level = p_energy_level
    union all
    select 2, '同類型及情境'::text,
      least(4::numeric, greatest(0.25::numeric, o.actual_minutes::numeric / o.estimated_minutes::numeric))
    from public.task_time_observations o
    where o.user_id = actor and o.task_type = p_task_type and o.task_context = p_context
    union all
    select 3, '同類型工作'::text,
      least(4::numeric, greatest(0.25::numeric, o.actual_minutes::numeric / o.estimated_minutes::numeric))
    from public.task_time_observations o
    where o.user_id = actor and o.task_type = p_task_type
    union all
    select 4, '你的所有有紀錄工作'::text,
      least(4::numeric, greatest(0.25::numeric, o.actual_minutes::numeric / o.estimated_minutes::numeric))
    from public.task_time_observations o
    where o.user_id = actor
  ), grouped as (
    select priority, candidate_basis, count(*)::integer as observations,
      percentile_cont(0.5) within group (order by ratio) as multiplier
    from candidates
    group by priority, candidate_basis
    having count(*) >= 3
  )
  select
    least(14400, greatest(1, round(p_estimated_minutes * multiplier)::integer)),
    observations,
    round(multiplier::numeric, 2),
    candidate_basis
  from grouped
  order by priority
  limit 1;
end;
$$;

revoke all on function public.time_estimate_suggestion(text, text, text, integer) from public, anon;
grant execute on function public.time_estimate_suggestion(text, text, text, integer) to authenticated;

comment on table public.task_time_observations is
  'Private per-user estimates versus actual task time. Task sharing never shares another participant''s learning data.';
