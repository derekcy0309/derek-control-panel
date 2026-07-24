-- Inbox Processing Mode
-- One-at-a-time processing with idempotent conversion, retained source data,
-- and a short safe Undo window. All changes are additive and backwards compatible.

create table if not exists public.inbox_processing_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  inbox_item_id uuid not null references public.operating_items(id) on delete restrict,
  session_id uuid not null,
  idempotency_key uuid not null,
  action text not null,
  target_type text,
  target_id uuid,
  original_item jsonb not null,
  processing_options jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by_id uuid references auth.users(id) on delete set null,
  constraint inbox_processing_action_check check (
    action in (
      'do_now',
      'create_task',
      'add_project',
      'add_waiting',
      'assign',
      'schedule',
      'keep_note',
      'skip'
    )
  ),
  constraint inbox_processing_target_check check (
    (target_type is null and target_id is null)
    or (target_type in ('task', 'operating_item') and target_id is not null)
  ),
  unique (user_id, idempotency_key)
);

alter table public.operating_items
  add column if not exists inbox_available_after timestamptz,
  add column if not exists inbox_processed_at timestamptz,
  add column if not exists inbox_processing_event_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'operating_items_inbox_processing_event_fkey'
      and conrelid = 'public.operating_items'::regclass
  ) then
    alter table public.operating_items
      add constraint operating_items_inbox_processing_event_fkey
      foreign key (inbox_processing_event_id)
      references public.inbox_processing_events(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists operating_items_inbox_queue_idx
  on public.operating_items(owner_id, created_at, id)
  where item_type = 'inbox' and status = 'inbox' and archived_at is null;

create index if not exists inbox_processing_events_user_recent_idx
  on public.inbox_processing_events(user_id, processed_at desc)
  where undone_at is null;

create index if not exists inbox_processing_events_session_idx
  on public.inbox_processing_events(user_id, session_id, processed_at);

create index if not exists inbox_processing_events_inbox_item_idx
  on public.inbox_processing_events(inbox_item_id);

create index if not exists inbox_processing_events_undone_by_idx
  on public.inbox_processing_events(undone_by_id)
  where undone_by_id is not null;

create index if not exists operating_items_inbox_event_idx
  on public.operating_items(inbox_processing_event_id)
  where inbox_processing_event_id is not null;

alter table public.inbox_processing_events enable row level security;

drop policy if exists inbox_processing_events_select_own
  on public.inbox_processing_events;
create policy inbox_processing_events_select_own
  on public.inbox_processing_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists inbox_processing_events_insert_own
  on public.inbox_processing_events;
create policy inbox_processing_events_insert_own
  on public.inbox_processing_events
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.operating_items i
      where i.id = inbox_item_id
        and i.owner_id = (select auth.uid())
    )
  );

drop policy if exists inbox_processing_events_update_own
  on public.inbox_processing_events;
create policy inbox_processing_events_update_own
  on public.inbox_processing_events
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.inbox_processing_events from anon, authenticated;
grant select, insert, update on public.inbox_processing_events to authenticated;

create or replace function public.process_inbox_item(
  p_inbox_item_id uuid,
  p_action text,
  p_session_id uuid,
  p_idempotency_key uuid,
  p_options jsonb default '{}'::jsonb
)
returns table (
  event_id uuid,
  processed_action text,
  target_type text,
  target_id uuid,
  processed_at timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  inbox_item public.operating_items%rowtype;
  existing_event public.inbox_processing_events%rowtype;
  new_event_id uuid := gen_random_uuid();
  new_target_id uuid;
  new_target_type text;
  new_title text;
  new_description text;
  new_next_action text;
  new_context text;
  new_area text;
  new_energy text;
  new_due_date date;
  new_planned_date date;
  new_estimated_minutes integer;
  handoff_target uuid;
  handoff_note text;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_inbox_item_id is null or p_session_id is null or p_idempotency_key is null then
    raise exception 'INBOX_PROCESSING_INVALID';
  end if;
  if p_action not in (
    'do_now',
    'create_task',
    'add_project',
    'add_waiting',
    'assign',
    'schedule',
    'keep_note',
    'skip'
  ) then
    raise exception 'INBOX_PROCESSING_ACTION_INVALID';
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'object' then
    raise exception 'INBOX_PROCESSING_INVALID';
  end if;

  select *
  into existing_event
  from public.inbox_processing_events e
  where e.user_id = actor
    and e.idempotency_key = p_idempotency_key;

  if found then
    return query
    select
      existing_event.id,
      existing_event.action,
      existing_event.target_type,
      existing_event.target_id,
      existing_event.processed_at;
    return;
  end if;

  select *
  into inbox_item
  from public.operating_items i
  where i.id = p_inbox_item_id
    and i.owner_id = actor
    and i.item_type = 'inbox'
    and i.status = 'inbox'
    and i.archived_at is null
    and i.inbox_processed_at is null
  for update;

  if not found then raise exception 'INBOX_ITEM_NOT_AVAILABLE'; end if;

  new_title := coalesce(
    nullif(left(btrim(p_options->>'title'), 500), ''),
    inbox_item.title
  );
  new_description := nullif(left(btrim(coalesce(p_options->>'description', inbox_item.description)), 10000), '');
  new_next_action := nullif(left(btrim(p_options->>'nextAction'), 5000), '');
  new_context := nullif(left(btrim(p_options->>'context'), 500), '');
  new_area := coalesce(nullif(p_options->>'area', ''), inbox_item.area);
  new_energy := nullif(p_options->>'energyLevel', '');
  handoff_note := nullif(left(btrim(p_options->>'handoffNote'), 5000), '');

  if new_area not in ('work', 'family', 'personal') then
    raise exception 'INBOX_PROCESSING_INVALID';
  end if;
  if new_energy is not null and new_energy not in ('low', 'medium', 'high') then
    raise exception 'INBOX_PROCESSING_INVALID';
  end if;

  if nullif(p_options->>'dueDate', '') is not null then
    new_due_date := (p_options->>'dueDate')::date;
  end if;
  if nullif(p_options->>'plannedDate', '') is not null then
    new_planned_date := (p_options->>'plannedDate')::date;
  end if;
  if nullif(p_options->>'estimatedMinutes', '') is not null then
    new_estimated_minutes := (p_options->>'estimatedMinutes')::integer;
    if new_estimated_minutes < 0 or new_estimated_minutes > 14400 then
      raise exception 'INBOX_PROCESSING_INVALID';
    end if;
  end if;
  if nullif(p_options->>'handoffToUserId', '') is not null then
    handoff_target := (p_options->>'handoffToUserId')::uuid;
  end if;

  if p_action = 'do_now' and new_next_action is null then
    raise exception 'INBOX_NEXT_ACTION_REQUIRED';
  end if;
  if p_action = 'schedule' and new_planned_date is null then
    raise exception 'INBOX_DATE_REQUIRED';
  end if;
  if p_action = 'assign' and (handoff_target is null or handoff_note is null) then
    raise exception 'INBOX_HANDOFF_REQUIRED';
  end if;

  if p_action in ('do_now', 'create_task', 'assign', 'schedule') then
    new_target_id := gen_random_uuid();
    new_target_type := 'task';

    insert into public.tasks (
      id,
      user_id,
      scope,
      source_type,
      title,
      due_date,
      status,
      next_action,
      risk,
      notes,
      owner_id,
      created_by_id,
      visibility,
      area,
      description,
      requested_priority,
      planned_date,
      estimated_minutes,
      energy_level,
      context,
      last_progress_at
    ) values (
      new_target_id,
      actor,
      case when new_area = 'work' then 'company' else 'home' end,
      'follow_up',
      new_title,
      new_due_date,
      case when p_action = 'do_now' then 'in_progress' else 'not_started' end,
      new_next_action,
      'low',
      nullif(left(btrim(p_options->>'notes'), 10000), ''),
      actor,
      actor,
      'private',
      new_area,
      new_description,
      3,
      case when p_action = 'do_now' then coalesce(new_planned_date, current_date) else new_planned_date end,
      new_estimated_minutes,
      new_energy,
      new_context,
      now()
    );

    if p_action = 'assign' then
      perform public.start_task_handoff(
        new_target_id,
        handoff_target,
        handoff_note,
        new_due_date
      );
    end if;
  elsif p_action in ('add_project', 'add_waiting', 'keep_note') then
    new_target_id := gen_random_uuid();
    new_target_type := 'operating_item';

    insert into public.operating_items (
      id,
      item_type,
      title,
      description,
      status,
      area,
      owner_id,
      created_by_id,
      visibility,
      due_date,
      next_action,
      sensitive,
      metadata,
      last_progress_at
    ) values (
      new_target_id,
      case p_action
        when 'add_project' then 'project'
        when 'add_waiting' then 'waiting'
        else 'note'
      end,
      new_title,
      new_description,
      case when p_action = 'add_waiting' then 'waiting' else 'active' end,
      new_area,
      actor,
      actor,
      'private',
      new_due_date,
      new_next_action,
      inbox_item.sensitive,
      coalesce(inbox_item.metadata, '{}'::jsonb) || jsonb_build_object(
        'inboxSourceItemId',
        inbox_item.id,
        'inboxSourceCreatedAt',
        inbox_item.created_at
      ),
      now()
    );
  end if;

  insert into public.inbox_processing_events (
    id,
    user_id,
    inbox_item_id,
    session_id,
    idempotency_key,
    action,
    target_type,
    target_id,
    original_item,
    processing_options
  ) values (
    new_event_id,
    actor,
    inbox_item.id,
    p_session_id,
    p_idempotency_key,
    p_action,
    new_target_type,
    new_target_id,
    to_jsonb(inbox_item),
    p_options
  )
  returning inbox_processing_events.processed_at
  into processed_at;

  if p_action = 'skip' then
    update public.operating_items
    set inbox_available_after = now() + interval '4 hours',
        inbox_processing_event_id = new_event_id,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'lastInboxAction',
          'skip',
          'lastInboxActionAt',
          now()
        ),
        last_progress_at = now()
    where id = inbox_item.id;
  else
    update public.operating_items
    set status = 'completed',
        archived_at = now(),
        inbox_processed_at = now(),
        inbox_processing_event_id = new_event_id,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'lastInboxAction',
          p_action,
          'lastInboxActionAt',
          now(),
          'inboxTargetType',
          new_target_type,
          'inboxTargetId',
          new_target_id
        ),
        last_progress_at = now()
    where id = inbox_item.id;
  end if;

  insert into public.activity_logs (
    resource_type,
    resource_id,
    actor_id,
    action,
    summary
  ) values (
    'operating_item',
    inbox_item.id,
    actor,
    'inbox_processed',
    '已處理一項收集箱內容'
  );

  return query
  select
    new_event_id,
    p_action,
    new_target_type,
    new_target_id,
    processed_at;
end;
$$;

create or replace function public.undo_last_inbox_processing(
  p_event_id uuid default null
)
returns table (
  event_id uuid,
  restored_inbox_item_id uuid
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor uuid := (select auth.uid());
  latest_event public.inbox_processing_events%rowtype;
  target_task public.tasks%rowtype;
  active_assignment public.assignments%rowtype;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select *
  into latest_event
  from public.inbox_processing_events e
  where e.user_id = actor
    and e.undone_at is null
  order by e.processed_at desc, e.id desc
  limit 1
  for update;

  if not found then raise exception 'INBOX_UNDO_NOT_AVAILABLE'; end if;
  if p_event_id is not null and latest_event.id <> p_event_id then
    raise exception 'INBOX_UNDO_NOT_LATEST';
  end if;
  if latest_event.processed_at < now() - interval '15 minutes' then
    raise exception 'INBOX_UNDO_EXPIRED';
  end if;

  if latest_event.target_type = 'task' then
    select *
    into target_task
    from public.tasks t
    where t.id = latest_event.target_id
      and t.owner_id = actor
    for update;

    if not found
      or target_task.deleted_at is not null
      or target_task.completed_at is not null
      or target_task.status in ('done', 'cancelled')
      or coalesce(target_task.progress, 0) > 0
      or exists (
        select 1
        from public.task_checkpoints c
        where c.task_id = latest_event.target_id
      )
    then
      raise exception 'INBOX_UNDO_TARGET_CHANGED';
    end if;

    select *
    into active_assignment
    from public.assignments a
    where a.resource_type = 'task'
      and a.resource_id = latest_event.target_id
      and a.assigned_by_id = actor
      and a.status in ('pending_acceptance', 'accepted', 'in_progress', 'waiting', 'blocked')
    order by a.created_at desc
    limit 1
    for update;

    if found then
      if active_assignment.status in ('waiting', 'blocked')
        or coalesce(active_assignment.progress, 0) > 0
      then
        raise exception 'INBOX_UNDO_TARGET_CHANGED';
      end if;
      perform public.reclaim_task_handoff(
        active_assignment.id,
        '撤銷最近一次收集箱處理'
      );
    end if;

    update public.share_records
    set revoked_at = coalesce(revoked_at, now())
    where resource_type = 'task'
      and resource_id = latest_event.target_id
      and owner_id = actor
      and revoked_at is null;

    update public.tasks
    set status = 'cancelled',
        assignee_id = null,
        deleted_at = now(),
        completed_at = null,
        last_progress_at = now()
    where id = latest_event.target_id
      and owner_id = actor;
  elsif latest_event.target_type = 'operating_item' then
    if not exists (
      select 1
      from public.operating_items i
      where i.id = latest_event.target_id
        and i.owner_id = actor
        and i.archived_at is null
    ) then
      raise exception 'INBOX_UNDO_TARGET_CHANGED';
    end if;

    update public.operating_items
    set status = 'cancelled',
        archived_at = now(),
        last_progress_at = now()
    where id = latest_event.target_id
      and owner_id = actor;
  end if;

  update public.operating_items
  set status = coalesce(latest_event.original_item->>'status', 'inbox'),
      archived_at = (latest_event.original_item->>'archived_at')::timestamptz,
      metadata = coalesce(latest_event.original_item->'metadata', '{}'::jsonb),
      last_progress_at = (latest_event.original_item->>'last_progress_at')::timestamptz,
      inbox_available_after = null,
      inbox_processed_at = null,
      inbox_processing_event_id = null
  where id = latest_event.inbox_item_id
    and owner_id = actor;

  if not found then raise exception 'INBOX_UNDO_SOURCE_MISSING'; end if;

  update public.inbox_processing_events
  set undone_at = now(),
      undone_by_id = actor
  where id = latest_event.id;

  insert into public.activity_logs (
    resource_type,
    resource_id,
    actor_id,
    action,
    summary
  ) values (
    'operating_item',
    latest_event.inbox_item_id,
    actor,
    'inbox_processing_undone',
    '已撤銷最近一次收集箱處理'
  );

  return query
  select latest_event.id, latest_event.inbox_item_id;
end;
$$;

revoke all on function public.process_inbox_item(uuid, text, uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.process_inbox_item(uuid, text, uuid, uuid, jsonb)
  to authenticated;

revoke all on function public.undo_last_inbox_processing(uuid)
  from public, anon;
grant execute on function public.undo_last_inbox_processing(uuid)
  to authenticated;

comment on table public.inbox_processing_events is
  'Private audit trail for one-at-a-time Inbox conversion. Retains the original item and supports a guarded recent Undo.';
comment on column public.inbox_processing_events.original_item is
  'Owner-private immutable snapshot of the original Inbox item, including source metadata.';
