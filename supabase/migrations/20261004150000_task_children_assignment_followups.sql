-- Keep legacy projects and task_steps intact. New child tasks are ordinary tasks.
alter table public.tasks
  add column if not exists parent_task_id uuid references public.tasks(id) on delete set null;

create index if not exists tasks_parent_active_idx
  on public.tasks(parent_task_id, created_at)
  where parent_task_id is not null and deleted_at is null and archived_at is null;

create or replace function private.validate_task_parent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_owner uuid;
begin
  if tg_op = 'UPDATE' then
    if new.parent_task_id is not distinct from old.parent_task_id or new.parent_task_id is null then
      return new;
    end if;
    raise exception 'TASK_PARENT_IMMUTABLE';
  end if;
  if new.parent_task_id is null then return new; end if;
  if new.parent_task_id = new.id then raise exception 'TASK_PARENT_INVALID'; end if;
  select coalesce(owner_id, user_id) into parent_owner
  from public.tasks
  where id = new.parent_task_id and deleted_at is null and archived_at is null;
  if parent_owner is null or parent_owner <> coalesce(new.owner_id, new.user_id) then
    raise exception 'TASK_PARENT_FORBIDDEN';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_task_parent() from public, anon, authenticated;
drop trigger if exists validate_task_parent_trigger on public.tasks;
create trigger validate_task_parent_trigger
before insert or update of parent_task_id on public.tasks
for each row execute function private.validate_task_parent();

alter table public.assignments
  add column if not exists acknowledged_at timestamptz;

create or replace function private.validate_assignment_acknowledgement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare delivery_id uuid;
begin
  if new.acknowledged_at is not distinct from old.acknowledged_at then return new; end if;
  if old.acknowledged_at is not null or new.acknowledged_at is null
     or new.assigned_to_id <> (select auth.uid())
     or old.status <> 'pending_acceptance' then
    raise exception 'ASSIGNMENT_ACK_FORBIDDEN';
  end if;
  new.acknowledged_at := now();
  delivery_id := private.enqueue_notification(
    new.assigned_by_id, 'handover_information', new.resource_type, new.resource_id,
    now(), 'handover-acknowledged:' || new.id::text
  );
  if delivery_id is not null then
    update public.notification_deliveries
    set generic_title = '交辦已確認收到',
        generic_body = '對方已確認收到一項工作交辦。',
        target_path = '/sharing'
    where id = delivery_id;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_assignment_acknowledgement() from public, anon, authenticated;
drop trigger if exists validate_assignment_acknowledgement_trigger on public.assignments;
create trigger validate_assignment_acknowledgement_trigger
before update of acknowledged_at on public.assignments
for each row execute function private.validate_assignment_acknowledgement();

-- The existing authenticated cron endpoint invokes this idempotent function.
-- Generic text prevents task titles or private notes reaching a lock screen.
create or replace function public.enqueue_assignment_followups(
  p_dispatch_secret text,
  p_now timestamptz default now()
)
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer := 0;
begin
  if not private.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'DISPATCH_FORBIDDEN';
  end if;

  insert into public.notification_deliveries (
    user_id, kind, resource_type, resource_id, deliver_at,
    dedupe_key, generic_title, generic_body, target_path
  )
  select assignment.assigned_by_id, 'handover_information', 'task', task.id,
    private.notification_after_quiet_hours(assignment.assigned_by_id, p_now),
    'assignment-followup:' || assignment.id::text || ':' || coalesce(assignment.due_date, task.due_date)::text,
    '已派工作接近限期', '一項已交俾對方的工作接近限期，可以追問進度。',
    '/tasks/' || task.id::text
  from public.assignments assignment
  join public.tasks task on task.id = assignment.resource_id
  join public.notification_preferences preference on preference.user_id = assignment.assigned_by_id
  where assignment.resource_type = 'task'
    and assignment.assigned_by_id <> assignment.assigned_to_id
    and (assignment.status in ('accepted', 'in_progress', 'waiting', 'blocked')
      or (assignment.status = 'pending_acceptance' and assignment.acknowledged_at is not null))
    and task.status not in ('done', 'cancelled')
    and task.deleted_at is null and task.archived_at is null
    and coalesce(assignment.due_date, task.due_date) is not null
    and preference.browser_enabled and preference.handover_enabled
    and ((coalesce(assignment.due_date, task.due_date) + time '09:00')
      at time zone preference.timezone) - make_interval(mins => preference.deadline_lead_minutes) <= p_now
    and coalesce(assignment.due_date, task.due_date) >= (p_now at time zone preference.timezone)::date
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
revoke all on function public.enqueue_assignment_followups(text, timestamptz) from public, authenticated;
grant execute on function public.enqueue_assignment_followups(text, timestamptz) to anon;
