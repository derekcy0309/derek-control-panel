-- Small, persistent steps belong to an existing task; completing one never
-- changes the parent task or its original next_action. Existing data is untouched.

create table if not exists public.task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  sort_order bigint generated always as identity,
  title text not null check (char_length(btrim(title)) between 1 and 250),
  status text not null default 'todo' check (status in ('todo', 'waiting', 'later', 'done')),
  waiting_note text check (waiting_note is null or char_length(waiting_note) <= 1000),
  follow_up_date date,
  completed_at timestamptz,
  created_by_id uuid not null,
  updated_by_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_steps_task_order_idx on public.task_steps(task_id, sort_order);
create index if not exists task_steps_creator_idx on public.task_steps(created_by_id);
create index if not exists task_steps_updater_idx on public.task_steps(updated_by_id);

create or replace function private.validate_task_step()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not private.current_user_can_checkpoint(new.task_id)
     or not exists (
       select 1 from public.tasks task
       where task.id = new.task_id
         and task.deleted_at is null and task.archived_at is null
     ) then
    raise exception 'TASK_STEP_FORBIDDEN';
  end if;
  if tg_op = 'UPDATE' and (
    new.id <> old.id or new.task_id <> old.task_id
    or new.sort_order <> old.sort_order
    or new.created_by_id is distinct from old.created_by_id
    or new.created_at <> old.created_at
  ) then
    raise exception 'TASK_STEP_IDENTITY_IMMUTABLE';
  end if;
  if tg_op = 'INSERT' and new.created_by_id <> (select auth.uid()) then
    raise exception 'TASK_STEP_AUTHOR_REQUIRED';
  end if;
  new.title := btrim(new.title);
  new.updated_by_id := (select auth.uid());
  new.updated_at := now();
  if new.status = 'done' then
    if tg_op = 'UPDATE' and old.status <> 'done' then
      new.completed_at := now();
    else
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  if new.status <> 'waiting' then
    new.waiting_note := null;
    new.follow_up_date := null;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_task_step() from public, anon, authenticated;

create trigger validate_task_step_trigger
before insert or update on public.task_steps
for each row execute function private.validate_task_step();

alter table public.task_steps enable row level security;
create policy task_steps_select_authorized on public.task_steps
for select to authenticated
using ((select private.current_user_can_read('task', task_id)));
create policy task_steps_insert_authorized on public.task_steps
for insert to authenticated
with check (created_by_id = (select auth.uid()) and (select private.current_user_can_checkpoint(task_id)));
create policy task_steps_update_authorized on public.task_steps
for update to authenticated
using ((select private.current_user_can_checkpoint(task_id)))
with check ((select private.current_user_can_checkpoint(task_id)));
create policy task_steps_delete_owner on public.task_steps
for delete to authenticated
using (exists (select 1 from public.tasks task where task.id = task_id and task.owner_id = (select auth.uid())));

revoke all on public.task_steps from public, anon, authenticated;
grant select, insert, update, delete on public.task_steps to authenticated;

-- Security-invoker view inherits task_steps RLS. One short title per visible
-- task keeps Today and Focus fast without copying step state onto tasks.
create or replace view public.task_current_steps with (security_invoker = true) as
select distinct on (step.task_id)
  step.task_id,
  case when step.status = 'done' then null else step.title end as title,
  case when step.status = 'done' then 'all_done' else step.status end as status,
  case when step.status = 'done' then null else step.follow_up_date end as follow_up_date
from public.task_steps step
order by step.task_id,
  case step.status when 'done' then 2 when 'later' then 1 else 0 end,
  step.sort_order;
revoke all on public.task_current_steps from public, anon;
grant select on public.task_current_steps to authenticated;

-- Extend the existing same-account, add-only restore in a single transaction.
-- V1 backups without taskSteps still work; the old restore function is retained.
create or replace function public.restore_backup_v2(p_backup jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  restored_counts jsonb;
  inserted_count integer := 0;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  restored_counts := public.restore_backup_v1(p_backup);
  if coalesce(jsonb_typeof(p_backup -> 'data' -> 'taskSteps'), 'array') <> 'array'
     or coalesce(jsonb_array_length(p_backup -> 'data' -> 'taskSteps'), 0) > 10000 then
    raise exception 'BACKUP_INVALID';
  end if;

  with payload as (
    select * from jsonb_populate_recordset(
      null::public.task_steps,
      coalesce(p_backup -> 'data' -> 'taskSteps', '[]'::jsonb)
    )
  )
  insert into public.task_steps (
    id, task_id, title, status, waiting_note, follow_up_date,
    completed_at, created_by_id, updated_by_id, created_at
  )
  select
    step.id, step.task_id, step.title, step.status,
    step.waiting_note, step.follow_up_date, step.completed_at,
    actor, actor, coalesce(step.created_at, now())
  from payload step
  join public.tasks task on task.id = step.task_id
    and task.owner_id = actor
    and task.archived_at is null and task.deleted_at is null
  where step.id is not null and nullif(btrim(step.title), '') is not null
  order by step.task_id, step.sort_order
  on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  return restored_counts || jsonb_build_object('taskSteps', inserted_count);
end;
$$;
revoke all on function public.restore_backup_v2(jsonb) from public, anon;
grant execute on function public.restore_backup_v2(jsonb) to authenticated;
