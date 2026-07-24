-- Today Auto-Plan remains a suggestion until the signed-in user accepts it.
-- The acceptance RPC is transactional and idempotent; it never changes task status.

alter table public.user_planning_metadata
  add column if not exists plan_role text,
  add column if not exists plan_source text,
  add column if not exists accepted_at timestamptz,
  add column if not exists plan_token uuid;

alter table public.user_planning_metadata
  drop constraint if exists user_planning_plan_role_check;
alter table public.user_planning_metadata
  add constraint user_planning_plan_role_check
  check (plan_role is null or plan_role in ('now', 'later', 'quick_win'));

alter table public.user_planning_metadata
  drop constraint if exists user_planning_plan_source_check;
alter table public.user_planning_metadata
  add constraint user_planning_plan_source_check
  check (plan_source is null or plan_source in ('manual', 'auto_plan'));

alter table public.daily_capacity_checkins
  add column if not exists rest_day boolean not null default false;

create index if not exists user_planning_today_plan_idx
  on public.user_planning_metadata(user_id, planned_date, plan_role)
  where planned_date is not null;

create table if not exists public.today_plan_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null,
  idempotency_key uuid not null,
  selection jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint today_plan_selection_array_check
    check (jsonb_typeof(selection) = 'array'),
  unique(user_id, idempotency_key)
);

create index if not exists today_plan_acceptances_user_date_idx
  on public.today_plan_acceptances(user_id, plan_date, created_at desc);

alter table public.today_plan_acceptances enable row level security;

drop policy if exists today_plan_acceptances_select_own
  on public.today_plan_acceptances;
create policy today_plan_acceptances_select_own
  on public.today_plan_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists today_plan_acceptances_insert_own
  on public.today_plan_acceptances;
create policy today_plan_acceptances_insert_own
  on public.today_plan_acceptances
  for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on public.today_plan_acceptances from anon;
revoke all on public.today_plan_acceptances from authenticated;
grant select, insert on public.today_plan_acceptances to authenticated;

create or replace function public.accept_today_auto_plan(
  p_task_ids uuid[],
  p_plan_roles text[],
  p_plan_date date,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  acceptance_id uuid;
  selected_count integer;
  visible_count integer;
  selection_json jsonb;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if p_plan_date is null then
    raise exception 'PLAN_DATE_REQUIRED';
  end if;

  selected_count := coalesce(array_length(p_task_ids, 1), 0);
  if selected_count < 1 or selected_count > 6
     or selected_count <> coalesce(array_length(p_plan_roles, 1), 0) then
    raise exception 'INVALID_PLAN_SIZE';
  end if;
  if (select count(distinct task_id) from unnest(p_task_ids) as task_id) <> selected_count then
    raise exception 'DUPLICATE_TASK';
  end if;
  if exists (
    select 1
    from unnest(p_plan_roles) as role_name
    where role_name not in ('now', 'later', 'quick_win')
  ) then
    raise exception 'INVALID_PLAN_ROLE';
  end if;
  if (select count(*) from unnest(p_plan_roles) as role_name where role_name = 'now') > 1
     or (select count(*) from unnest(p_plan_roles) as role_name where role_name = 'later') > 2
     or (select count(*) from unnest(p_plan_roles) as role_name where role_name = 'quick_win') > 3 then
    raise exception 'INVALID_PLAN_ROLE_COUNT';
  end if;

  select count(*)
  into visible_count
  from public.tasks task
  where task.id = any(p_task_ids)
    and task.deleted_at is null
    and task.archived_at is null
    and task.status not in ('done', 'cancelled', 'blocked', 'waiting')
    and nullif(btrim(coalesce(task.blocked_reason, '')), '') is null
    and (
      coalesce(task.owner_id, task.user_id) = current_user_id
      or exists (
        select 1
        from public.assignments assignment
        where assignment.resource_type = 'task'
          and assignment.resource_id = task.id
          and assignment.assigned_to_id = current_user_id
          and assignment.status in ('accepted', 'in_progress')
      )
    );
  if visible_count <> selected_count then
    raise exception 'TASK_NOT_ELIGIBLE';
  end if;

  select jsonb_agg(
    jsonb_build_object('taskId', task_id, 'role', role_name)
    order by ordinal
  )
  into selection_json
  from unnest(p_task_ids, p_plan_roles) with ordinality
    as selected(task_id, role_name, ordinal);

  insert into public.today_plan_acceptances(
    user_id, plan_date, idempotency_key, selection
  )
  values (
    current_user_id, p_plan_date, p_idempotency_key, selection_json
  )
  on conflict (user_id, idempotency_key) do nothing
  returning id into acceptance_id;

  if acceptance_id is null then
    select id
    into acceptance_id
    from public.today_plan_acceptances
    where user_id = current_user_id
      and idempotency_key = p_idempotency_key;
    return acceptance_id;
  end if;

  update public.user_planning_metadata
  set planned_date = null,
      plan_role = null,
      plan_source = null,
      accepted_at = null,
      plan_token = null,
      updated_at = now()
  where user_id = current_user_id
    and resource_type = 'task'
    and planned_date = p_plan_date
    and plan_source = 'auto_plan';

  insert into public.user_planning_metadata(
    user_id,
    resource_type,
    resource_id,
    personal_priority,
    planned_date,
    plan_role,
    plan_source,
    accepted_at,
    plan_token,
    updated_at
  )
  select
    current_user_id,
    'task',
    selected.task_id,
    3,
    p_plan_date,
    selected.role_name,
    'auto_plan',
    now(),
    p_idempotency_key,
    now()
  from unnest(p_task_ids, p_plan_roles)
    as selected(task_id, role_name)
  on conflict (user_id, resource_type, resource_id)
  do update set
    planned_date = excluded.planned_date,
    plan_role = excluded.plan_role,
    plan_source = excluded.plan_source,
    accepted_at = excluded.accepted_at,
    plan_token = excluded.plan_token,
    updated_at = excluded.updated_at;

  return acceptance_id;
end;
$$;

revoke all on function public.accept_today_auto_plan(uuid[], text[], date, uuid)
  from public, anon;
grant execute on function public.accept_today_auto_plan(uuid[], text[], date, uuid)
  to authenticated;
