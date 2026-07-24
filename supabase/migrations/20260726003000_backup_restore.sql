-- Account-scoped structured backup restore.
--
-- The function is SECURITY INVOKER: normal RLS policies remain in force and a
-- caller can only restore rows owned by their authenticated account.  It never
-- updates existing data; conflicting rows are deliberately skipped.

create table if not exists public.backup_restore_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_kind text not null check (event_kind in ('export', 'preview', 'restore')),
  backup_exported_at timestamptz,
  record_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(record_counts) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists backup_restore_audit_logs_user_created_idx
  on public.backup_restore_audit_logs(user_id, created_at desc);

alter table public.backup_restore_audit_logs enable row level security;

drop policy if exists backup_restore_audit_logs_select_own on public.backup_restore_audit_logs;
create policy backup_restore_audit_logs_select_own
on public.backup_restore_audit_logs for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists backup_restore_audit_logs_insert_own on public.backup_restore_audit_logs;
create policy backup_restore_audit_logs_insert_own
on public.backup_restore_audit_logs for insert to authenticated
with check (user_id = (select auth.uid()));

revoke all on public.backup_restore_audit_logs from public, anon;
grant select, insert on public.backup_restore_audit_logs to authenticated;

create or replace function public.restore_backup_v1(p_backup jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  backup_data jsonb := p_backup -> 'data';
  exported_at timestamptz;
  collection_name text;
  inserted_count integer := 0;
  restored_counts jsonb := '{}'::jsonb;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p_backup) <> 'object'
     or p_backup ->> 'format' <> 'derek-control-panel-backup'
     or p_backup ->> 'version' <> '1'
     or p_backup ->> 'ownerId' <> actor::text
     or jsonb_typeof(backup_data) <> 'object'
  then
    raise exception 'BACKUP_INVALID';
  end if;

  begin
    exported_at := (p_backup ->> 'exportedAt')::timestamptz;
  exception when others then
    raise exception 'BACKUP_INVALID';
  end;

  foreach collection_name in array array[
    'tasks', 'operatingItems', 'transactions', 'meetings', 'balances', 'planning',
    'capacityCheckins', 'checkpoints', 'taskResources', 'recurrenceRules',
    'dependencies', 'milestones', 'weeklyReviews', 'focusSessions',
    'timeObservations', 'notificationPreferences'
  ] loop
    if coalesce(jsonb_typeof(backup_data -> collection_name), 'array') <> 'array'
       or coalesce(jsonb_array_length(backup_data -> collection_name), 0) > 10000
    then
      raise exception 'BACKUP_INVALID';
    end if;
  end loop;

  -- Restore projects/items first so task project references can be retained.
  with payload as (
    select * from jsonb_populate_recordset(null::public.operating_items, coalesce(backup_data -> 'operatingItems', '[]'::jsonb))
  )
  insert into public.operating_items (
    id, item_type, title, description, status, area, owner_id, created_by_id,
    assignee_id, visibility, due_date, next_action, sensitive, metadata,
    last_progress_at, archived_at, created_at, updated_at, inbox_available_after,
    inbox_processed_at, inbox_processing_event_id
  )
  select
    p.id, p.item_type, p.title, p.description, p.status, p.area, actor, actor,
    null, 'private', p.due_date, p.next_action, p.sensitive, coalesce(p.metadata, '{}'::jsonb),
    p.last_progress_at, p.archived_at, p.created_at, p.updated_at, p.inbox_available_after,
    p.inbox_processed_at, null
  from payload p
  where p.id is not null and nullif(btrim(p.title), '') is not null
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  restored_counts := restored_counts || jsonb_build_object('operatingItems', inserted_count);

  with payload as (
    select * from jsonb_populate_recordset(null::public.tasks, coalesce(backup_data -> 'tasks', '[]'::jsonb))
  )
  insert into public.tasks (
    id, user_id, scope, source_type, title, owner, due_date, follow_up_date,
    status, next_action, risk, notes, archived_at, created_at, updated_at,
    completed_at, deleted_at, owner_id, created_by_id, visibility, area,
    description, assignee_id, requested_priority, planned_date, estimated_minutes,
    actual_minutes, energy_level, context, definition_of_done, required_information,
    blocked_reason, critical_path, revenue_impact, safety_impact, child_impact,
    legal_impact, last_progress_at, snoozed_until, estimated_duration_days,
    buffer_days, latest_safe_start_date, progress, project_id, recurrence_rule_id
  )
  select
    p.id, actor, p.scope, p.source_type, p.title, p.owner, p.due_date, p.follow_up_date,
    p.status, p.next_action, p.risk, p.notes, p.archived_at, p.created_at, p.updated_at,
    p.completed_at, p.deleted_at, actor, actor, 'private', p.area,
    p.description, null, p.requested_priority, p.planned_date, p.estimated_minutes,
    p.actual_minutes, p.energy_level, p.context, p.definition_of_done, p.required_information,
    p.blocked_reason, p.critical_path, p.revenue_impact, p.safety_impact, p.child_impact,
    p.legal_impact, p.last_progress_at, p.snoozed_until, p.estimated_duration_days,
    p.buffer_days, p.latest_safe_start_date, p.progress,
    case when p.project_id is not null and exists (
      select 1 from public.operating_items project
      where project.id = p.project_id and project.owner_id = actor and project.item_type = 'project'
    ) then p.project_id else null end,
    null
  from payload p
  where p.id is not null and nullif(btrim(p.title), '') is not null
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  restored_counts := restored_counts || jsonb_build_object('tasks', inserted_count);

  with payload as (
    select * from jsonb_populate_recordset(null::public.transactions, coalesce(backup_data -> 'transactions', '[]'::jsonb))
  )
  insert into public.transactions (
    id, user_id, scope, type, item, category, amount, expected_date, actual_date,
    frequency, status, payment_method, owner, proof_url, notes, archived_at, created_at, updated_at
  )
  select p.id, actor, p.scope, p.type, p.item, p.category, p.amount, p.expected_date, p.actual_date,
    p.frequency, p.status, p.payment_method, p.owner, p.proof_url, p.notes, p.archived_at, p.created_at, p.updated_at
  from payload p
  where p.id is not null and nullif(btrim(p.item), '') is not null
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  restored_counts := restored_counts || jsonb_build_object('transactions', inserted_count);

  with payload as (
    select * from jsonb_populate_recordset(null::public.meetings, coalesce(backup_data -> 'meetings', '[]'::jsonb))
  )
  insert into public.meetings (
    id, user_id, scope, meeting_name, meeting_date, raw_notes, summary, archived_at, created_at, updated_at
  )
  select p.id, actor, p.scope, p.meeting_name, p.meeting_date, p.raw_notes, p.summary, p.archived_at, p.created_at, p.updated_at
  from payload p
  where p.id is not null and nullif(btrim(p.meeting_name), '') is not null
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  restored_counts := restored_counts || jsonb_build_object('meetings', inserted_count);

  with payload as (
    select * from jsonb_populate_recordset(null::public.balances, coalesce(backup_data -> 'balances', '[]'::jsonb))
  )
  insert into public.balances (
    id, user_id, scope, month, opening_balance, archived_at, created_at, updated_at
  )
  select p.id, actor, p.scope, p.month, p.opening_balance, p.archived_at, p.created_at, p.updated_at
  from payload p
  where p.id is not null
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  restored_counts := restored_counts || jsonb_build_object('balances', inserted_count);

  with payload as (
    select * from jsonb_populate_recordset(null::public.daily_capacity_checkins, coalesce(backup_data -> 'capacityCheckins', '[]'::jsonb))
  )
  insert into public.daily_capacity_checkins (
    id, user_id, checkin_date, energy_level, available_minutes, mode, essential_only,
    notes, created_at, updated_at, rest_day
  )
  select p.id, actor, p.checkin_date, p.energy_level, p.available_minutes, p.mode, p.essential_only,
    p.notes, p.created_at, p.updated_at, p.rest_day
  from payload p
  where p.id is not null
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  restored_counts := restored_counts || jsonb_build_object('capacityCheckins', inserted_count);

  with payload as (
    select * from jsonb_populate_recordset(null::public.user_planning_metadata, coalesce(backup_data -> 'planning', '[]'::jsonb))
  )
  insert into public.user_planning_metadata (
    user_id, resource_type, resource_id, personal_priority, planned_date, snoozed_until,
    pinned, hidden_from_today, updated_at, plan_role, plan_source, accepted_at, plan_token
  )
  select actor, p.resource_type, p.resource_id, p.personal_priority, p.planned_date, p.snoozed_until,
    p.pinned, p.hidden_from_today, p.updated_at, p.plan_role, p.plan_source, p.accepted_at, p.plan_token
  from payload p
  where (p.resource_type = 'task' and exists (
    select 1 from public.tasks task where task.id = p.resource_id and task.owner_id = actor
  )) or (p.resource_type = 'operating_item' and exists (
    select 1 from public.operating_items item where item.id = p.resource_id and item.owner_id = actor
  ))
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  restored_counts := restored_counts || jsonb_build_object('planning', inserted_count);

  with payload as (
    select * from jsonb_populate_recordset(null::public.task_checkpoints, coalesce(backup_data -> 'checkpoints', '[]'::jsonb))
  )
  insert into public.task_checkpoints (
    id, task_id, author_id, state, completed_summary, current_position, next_minimum_step,
    resource_links, blocked_reason, last_worked_at, created_at, updated_at, client_mutation_id
  )
  select p.id, p.task_id, actor, p.state, p.completed_summary, p.current_position, p.next_minimum_step,
    coalesce(p.resource_links, '[]'::jsonb), p.blocked_reason, p.last_worked_at, p.created_at, p.updated_at, null
  from payload p
  where p.id is not null and exists (
    select 1 from public.tasks task where task.id = p.task_id and task.owner_id = actor
  )
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  restored_counts := restored_counts || jsonb_build_object('checkpoints', inserted_count);

  -- Only non-Storage resources are restored. Storage files themselves are
  -- intentionally never copied by a JSON backup.
  with payload as (
    select * from jsonb_populate_recordset(null::public.task_resources, coalesce(backup_data -> 'taskResources', '[]'::jsonb))
  )
  insert into public.task_resources (
    id, task_id, owner_id, resource_type, label, url, storage_bucket, storage_path,
    linked_item_id, contact_name, contact_phone, contact_email, share_with_task,
    created_at, updated_at
  )
  select p.id, p.task_id, actor, p.resource_type, p.label, p.url, null, null,
    p.linked_item_id, p.contact_name, p.contact_phone, p.contact_email, p.share_with_task,
    p.created_at, p.updated_at
  from payload p
  where p.id is not null and p.storage_bucket is null and p.storage_path is null and exists (
    select 1 from public.tasks task where task.id = p.task_id and task.owner_id = actor
  )
  and (p.linked_item_id is null or exists (
    select 1 from public.operating_items item where item.id = p.linked_item_id and item.owner_id = actor
  ))
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  restored_counts := restored_counts || jsonb_build_object('taskResources', inserted_count);

  with payload as (
    select * from jsonb_populate_recordset(null::public.task_dependencies, coalesce(backup_data -> 'dependencies', '[]'::jsonb))
  )
  insert into public.task_dependencies (id, task_id, depends_on_task_id, created_by_id, created_at)
  select p.id, p.task_id, p.depends_on_task_id, actor, p.created_at
  from payload p
  where p.id is not null
    and exists (select 1 from public.tasks task where task.id = p.task_id and task.owner_id = actor)
    and exists (select 1 from public.tasks prerequisite where prerequisite.id = p.depends_on_task_id and prerequisite.owner_id = actor)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  restored_counts := restored_counts || jsonb_build_object('dependencies', inserted_count);

  with payload as (
    select * from jsonb_populate_recordset(null::public.project_milestones, coalesce(backup_data -> 'milestones', '[]'::jsonb))
  )
  insert into public.project_milestones (
    id, project_id, created_by_id, title, description, deadline, status, critical,
    completed_at, created_at, updated_at
  )
  select p.id, p.project_id, actor, p.title, p.description, p.deadline, p.status, p.critical,
    p.completed_at, p.created_at, p.updated_at
  from payload p
  where p.id is not null and nullif(btrim(p.title), '') is not null and exists (
    select 1 from public.operating_items project
    where project.id = p.project_id and project.owner_id = actor and project.item_type = 'project'
  )
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  restored_counts := restored_counts || jsonb_build_object('milestones', inserted_count);

  with payload as (
    select * from jsonb_populate_recordset(null::public.weekly_reviews, coalesce(backup_data -> 'weeklyReviews', '[]'::jsonb))
  )
  insert into public.weekly_reviews (
    id, user_id, week_start, status, next_week_outcomes, next_week_available_minutes,
    rebalancing_note, next_minimum_action, reflection, review_snapshot, completed_at,
    created_at, updated_at
  )
  select p.id, actor, p.week_start, p.status, p.next_week_outcomes, p.next_week_available_minutes,
    p.rebalancing_note, p.next_minimum_action, p.reflection, coalesce(p.review_snapshot, '{}'::jsonb), p.completed_at,
    p.created_at, p.updated_at
  from payload p
  where p.id is not null
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  restored_counts := restored_counts || jsonb_build_object('weeklyReviews', inserted_count);

  insert into public.backup_restore_audit_logs (
    user_id, event_kind, backup_exported_at, record_counts
  ) values (
    actor, 'restore', exported_at, restored_counts
  );

  return restored_counts;
end;
$$;

revoke all on function public.restore_backup_v1(jsonb) from public, anon;
grant execute on function public.restore_backup_v1(jsonb) to authenticated;

comment on function public.restore_backup_v1(jsonb) is
  'Restores a same-account V1 backup transactionally. Existing rows are never updated or overwritten.';
