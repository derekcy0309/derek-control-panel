-- Task Dependencies and Project Milestones
--
-- This is deliberately additive: existing tasks and operating items remain
-- unchanged. A dependency is an explicit planning relationship only; it never
-- changes a task's status, assignment, or handover automatically.

alter table public.tasks
  add column if not exists project_id uuid references public.operating_items(id) on delete set null;

create index if not exists tasks_project_status_idx
  on public.tasks(project_id, status)
  where project_id is not null and deleted_at is null and archived_at is null;

create table if not exists public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  created_by_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint task_dependencies_not_self check (task_id <> depends_on_task_id),
  constraint task_dependencies_unique unique (task_id, depends_on_task_id)
);

create index if not exists task_dependencies_task_idx on public.task_dependencies(task_id);
create index if not exists task_dependencies_prerequisite_idx on public.task_dependencies(depends_on_task_id);

create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.operating_items(id) on delete cascade,
  created_by_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text,
  deadline date,
  status text not null default 'active' check (status in ('active', 'blocked', 'completed', 'cancelled')),
  critical boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_milestones_project_deadline_idx
  on public.project_milestones(project_id, deadline, status);

create or replace function private.current_user_can_edit(p_resource_type text, p_resource_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select auth.uid()) is not null and (
    exists (
      select 1 from public.tasks t
      where p_resource_type = 'task'
        and t.id = p_resource_id
        and t.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.operating_items i
      where p_resource_type = 'operating_item'
        and i.id = p_resource_id
        and i.owner_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.share_records s
      where s.resource_type = p_resource_type
        and s.resource_id = p_resource_id
        and s.shared_with_user_id = (select auth.uid())
        and s.revoked_at is null
        and (s.expires_at is null or s.expires_at > now())
        and s.permission = 'edit'
    )
    or exists (
      select 1
      from public.share_records s
      join public.joint_memberships j
        on j.resource_type = s.resource_type
       and j.resource_id = s.resource_id
       and j.user_id = s.shared_with_user_id
       and j.accepted_at is not null
       and j.removed_at is null
      where s.resource_type = p_resource_type
        and s.resource_id = p_resource_id
        and s.shared_with_user_id = (select auth.uid())
        and s.revoked_at is null
        and (s.expires_at is null or s.expires_at > now())
        and s.permission = 'co_owner'
    )
  );
$$;

revoke all on function private.current_user_can_edit(text, uuid) from public, anon;
grant execute on function private.current_user_can_edit(text, uuid) to authenticated;

create or replace function private.validate_task_project_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.project_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.operating_items project
    where project.id = new.project_id
      and project.item_type = 'project'
      and project.archived_at is null
  ) then
    raise exception 'TASK_PROJECT_INVALID';
  end if;

  if not private.current_user_can_read('operating_item', new.project_id) then
    raise exception 'TASK_PROJECT_ACCESS_DENIED';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_task_project_reference_trigger on public.tasks;
create trigger validate_task_project_reference_trigger
before insert or update of project_id on public.tasks
for each row execute function private.validate_task_project_reference();
revoke all on function private.validate_task_project_reference() from public, anon, authenticated;

create or replace function private.prevent_task_dependency_cycle()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.task_id = new.depends_on_task_id then
    raise exception 'TASK_DEPENDENCY_SELF_REFERENCE';
  end if;

  if exists (
    with recursive chain(task_id) as (
      select new.depends_on_task_id
      union
      select dependency.depends_on_task_id
      from public.task_dependencies dependency
      join chain on chain.task_id = dependency.task_id
      where tg_op = 'INSERT' or dependency.id <> new.id
    )
    select 1 from chain where task_id = new.task_id
  ) then
    raise exception 'TASK_DEPENDENCY_CYCLE';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_task_dependency_cycle_trigger on public.task_dependencies;
create trigger prevent_task_dependency_cycle_trigger
before insert or update of task_id, depends_on_task_id on public.task_dependencies
for each row execute function private.prevent_task_dependency_cycle();
revoke all on function private.prevent_task_dependency_cycle() from public, anon, authenticated;

create or replace function private.prepare_project_milestone()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'MILESTONE_PROJECT_IMMUTABLE';
  end if;

  if not exists (
    select 1
    from public.operating_items project
    where project.id = new.project_id
      and project.item_type = 'project'
      and project.archived_at is null
  ) then
    raise exception 'MILESTONE_PROJECT_INVALID';
  end if;

  if new.status = 'completed' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists prepare_project_milestone_trigger on public.project_milestones;
create trigger prepare_project_milestone_trigger
before insert or update on public.project_milestones
for each row execute function private.prepare_project_milestone();
revoke all on function private.prepare_project_milestone() from public, anon, authenticated;

alter table public.task_dependencies enable row level security;
alter table public.project_milestones enable row level security;

drop policy if exists task_dependencies_select_authorized on public.task_dependencies;
create policy task_dependencies_select_authorized on public.task_dependencies
for select to authenticated
using (
  private.current_user_can_read('task', task_id)
  and private.current_user_can_read('task', depends_on_task_id)
);

drop policy if exists task_dependencies_insert_editor on public.task_dependencies;
create policy task_dependencies_insert_editor on public.task_dependencies
for insert to authenticated
with check (
  created_by_id = (select auth.uid())
  and private.current_user_can_edit('task', task_id)
  and private.current_user_can_read('task', depends_on_task_id)
);

drop policy if exists task_dependencies_delete_editor on public.task_dependencies;
create policy task_dependencies_delete_editor on public.task_dependencies
for delete to authenticated
using (private.current_user_can_edit('task', task_id));

drop policy if exists project_milestones_select_authorized on public.project_milestones;
create policy project_milestones_select_authorized on public.project_milestones
for select to authenticated
using (private.current_user_can_read('operating_item', project_id));

drop policy if exists project_milestones_insert_editor on public.project_milestones;
create policy project_milestones_insert_editor on public.project_milestones
for insert to authenticated
with check (
  created_by_id = (select auth.uid())
  and private.current_user_can_edit('operating_item', project_id)
);

drop policy if exists project_milestones_update_editor on public.project_milestones;
create policy project_milestones_update_editor on public.project_milestones
for update to authenticated
using (private.current_user_can_edit('operating_item', project_id))
with check (private.current_user_can_edit('operating_item', project_id));

drop policy if exists project_milestones_delete_editor on public.project_milestones;
create policy project_milestones_delete_editor on public.project_milestones
for delete to authenticated
using (private.current_user_can_edit('operating_item', project_id));

revoke all on table public.task_dependencies, public.project_milestones from anon;
grant select, insert, update, delete on table public.task_dependencies, public.project_milestones to authenticated;
