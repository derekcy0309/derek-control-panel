-- Additive scheduling fields. Existing tasks keep their current deadline behaviour.
alter table public.tasks
  add column if not exists work_start_date date,
  add column if not exists work_dates date[];

alter table public.user_planning_metadata
  add column if not exists plan_position integer;

create or replace function private.valid_task_work_dates(p_start date, p_due date, p_dates date[])
returns boolean language sql immutable set search_path = '' as $$
  select p_start is not null and p_due is not null and p_start <= p_due
    and p_dates is not null and cardinality(p_dates) between 1 and 90
    and not exists (
      select 1 from unnest(p_dates) as selected(day)
      where selected.day is null or selected.day < p_start or selected.day > p_due
    )
    and cardinality(p_dates) = (select count(distinct selected.day) from unnest(p_dates) as selected(day));
$$;
revoke all on function private.valid_task_work_dates(date, date, date[]) from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.tasks'::regclass and conname = 'tasks_work_schedule_valid') then
    alter table public.tasks add constraint tasks_work_schedule_valid
      check ((work_start_date is null and work_dates is null)
        or private.valid_task_work_dates(work_start_date, due_date, work_dates));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_planning_metadata'::regclass and conname = 'planning_position_valid') then
    alter table public.user_planning_metadata add constraint planning_position_valid
      check (plan_position is null or plan_position between 1 and 30);
  end if;
end $$;

-- Only the signed-in user's already-included Today items can be reordered.
create or replace function public.reorder_today_tasks(p_task_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  today date := (now() at time zone 'Asia/Hong_Kong')::date;
begin
  if actor is null or p_task_ids is null or cardinality(p_task_ids) not between 1 and 30
     or cardinality(p_task_ids) <> (select count(distinct id) from unnest(p_task_ids) as input(id)) then
    raise exception 'TODAY_ORDER_INVALID';
  end if;
  if exists (
    select 1 from unnest(p_task_ids) as input(id)
    where not exists (
      select 1 from public.user_planning_metadata metadata
      join public.tasks task on task.id = metadata.resource_id
      where metadata.user_id = actor and metadata.resource_type = 'task'
        and metadata.resource_id = input.id and metadata.planned_date = today
        and metadata.plan_role is not null
        and task.status not in ('done', 'cancelled')
        and task.deleted_at is null and task.archived_at is null
    )
  ) then
    raise exception 'TODAY_ORDER_FORBIDDEN';
  end if;

  update public.user_planning_metadata metadata
  set plan_position = null,
      plan_role = case when metadata.plan_role = 'now' then 'later' else metadata.plan_role end,
      updated_at = now()
  where metadata.user_id = actor and metadata.resource_type = 'task'
    and metadata.planned_date = today and metadata.plan_role is not null;

  update public.user_planning_metadata metadata
  set plan_position = ordered.position::integer,
      plan_role = case when ordered.position = 1 then 'now' else 'later' end,
      plan_source = 'manual', accepted_at = coalesce(metadata.accepted_at, now()), updated_at = now()
  from unnest(p_task_ids) with ordinality as ordered(task_id, position)
  where metadata.user_id = actor and metadata.resource_type = 'task'
    and metadata.resource_id = ordered.task_id and metadata.planned_date = today;
end;
$$;
revoke all on function public.reorder_today_tasks(uuid[]) from public, anon;
grant execute on function public.reorder_today_tasks(uuid[]) to authenticated;

-- Legacy deadline notifications are unchanged for tasks without chosen work days.
create or replace function public.enqueue_due_notifications(
  p_dispatch_secret text, p_now timestamptz default now()
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  item record;
  desired_at timestamptz;
  inserted_id uuid;
  inserted_count integer := 0;
begin
  if not private.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'DISPATCH_FORBIDDEN';
  end if;

  for item in
    select preference.*, metadata.resource_id
    from public.notification_preferences preference
    join public.user_planning_metadata metadata
      on metadata.user_id = preference.user_id and metadata.resource_type = 'task'
     and metadata.planned_date = (p_now at time zone preference.timezone)::date
     and metadata.plan_role = 'now'
    join public.tasks task on task.id = metadata.resource_id
     and task.status not in ('done', 'cancelled', 'blocked', 'waiting')
     and task.deleted_at is null and task.archived_at is null
     and (task.work_dates is null or (p_now at time zone preference.timezone)::date = any(task.work_dates)
       or metadata.plan_source = 'manual')
    where preference.browser_enabled and preference.today_first_enabled
  loop
    desired_at := private.notification_local_time(
      (p_now at time zone item.timezone)::date, item.today_reminder_time, item.timezone
    );
    if desired_at between p_now - interval '30 minutes' and p_now + interval '5 minutes' then
      inserted_id := private.enqueue_notification(
        item.user_id, 'today_first', 'task', item.resource_id, desired_at,
        'today-first:' || (p_now at time zone item.timezone)::date::text
      );
      if inserted_id is not null then inserted_count := inserted_count + 1; end if;
    end if;
  end loop;

  for item in
    with recipients as (
      select task.id resource_id, coalesce(task.owner_id, task.user_id) user_id, task.due_date
      from public.tasks task
      where task.due_date is not null and task.work_dates is null
        and task.status not in ('done', 'cancelled')
        and task.deleted_at is null and task.archived_at is null
      union
      select task.id, assignment.assigned_to_id, task.due_date
      from public.tasks task
      join public.assignments assignment on assignment.resource_type = 'task'
       and assignment.resource_id = task.id and assignment.status in ('accepted', 'in_progress')
      where task.due_date is not null and task.work_dates is null
        and task.status not in ('done', 'cancelled')
        and task.deleted_at is null and task.archived_at is null
    )
    select preference.*, recipient.resource_id, recipient.due_date
    from recipients recipient
    join public.notification_preferences preference on preference.user_id = recipient.user_id
    where preference.browser_enabled and preference.deadline_enabled
      and recipient.due_date between
        (p_now at time zone preference.timezone)::date
        and (p_now at time zone preference.timezone)::date + 8
  loop
    desired_at := private.notification_local_time(item.due_date, time '09:00', item.timezone)
      - make_interval(mins => item.deadline_lead_minutes);
    if desired_at between p_now - interval '30 minutes' and p_now + interval '5 minutes' then
      inserted_id := private.enqueue_notification(
        item.user_id, 'deadline', 'task', item.resource_id, desired_at,
        'deadline:' || item.resource_id::text || ':' || item.due_date::text
          || ':' || item.deadline_lead_minutes::text
      );
      if inserted_id is not null then inserted_count := inserted_count + 1; end if;
    end if;
  end loop;

  -- A chosen work day uses the user's ordinary reminder time, once per task/day.
  -- The generic push text does not disclose the task title or private notes.
  for item in
    with recipients as (
      select task.id resource_id, coalesce(task.owner_id, task.user_id) user_id, task.work_dates
      from public.tasks task
      where task.work_dates is not null and task.status not in ('done', 'cancelled', 'blocked', 'waiting')
        and task.deleted_at is null and task.archived_at is null
      union
      select task.id, assignment.assigned_to_id, task.work_dates
      from public.tasks task
      join public.assignments assignment on assignment.resource_type = 'task'
       and assignment.resource_id = task.id and assignment.status in ('accepted', 'in_progress')
      where task.work_dates is not null and task.status not in ('done', 'cancelled', 'blocked', 'waiting')
        and task.deleted_at is null and task.archived_at is null
    )
    select preference.*, recipient.resource_id, (p_now at time zone preference.timezone)::date as work_day
    from recipients recipient
    join public.notification_preferences preference on preference.user_id = recipient.user_id
    where preference.browser_enabled and preference.deadline_enabled
      and (p_now at time zone preference.timezone)::date = any(recipient.work_dates)
      and not exists (
        select 1 from public.user_planning_metadata metadata
        where metadata.user_id = recipient.user_id and metadata.resource_type = 'task'
          and metadata.resource_id = recipient.resource_id
          and metadata.planned_date = (p_now at time zone preference.timezone)::date
          and metadata.plan_role = 'now' and preference.today_first_enabled
      )
  loop
    desired_at := private.notification_local_time(item.work_day, item.today_reminder_time, item.timezone);
    if desired_at between p_now - interval '30 minutes' and p_now + interval '5 minutes' then
      inserted_id := private.enqueue_notification(
        item.user_id, 'deadline', 'task', item.resource_id, desired_at,
        'task-work-day:' || item.resource_id::text || ':' || item.work_day::text
      );
      if inserted_id is not null then
        update public.notification_deliveries
        set generic_title = '安排工作日', generic_body = '你揀咗今日處理一項工作。',
            target_path = '/tasks/' || item.resource_id::text
        where id = inserted_id;
        inserted_count := inserted_count + 1;
      end if;
    end if;
  end loop;

  for item in
    with waiting_items as (
      select coalesce(task.owner_id, task.user_id) user_id, 'task'::text resource_type,
        task.id resource_id, task.follow_up_date follow_date
      from public.tasks task
      where task.status = 'waiting' and task.follow_up_date is not null
        and task.deleted_at is null and task.archived_at is null
      union all
      select operating.owner_id, 'operating_item', operating.id, operating.due_date
      from public.operating_items operating
      where operating.status = 'waiting' and operating.due_date is not null and operating.archived_at is null
    )
    select preference.*, waiting.resource_type, waiting.resource_id, waiting.follow_date
    from waiting_items waiting
    join public.notification_preferences preference on preference.user_id = waiting.user_id
    where preference.browser_enabled and preference.waiting_enabled
      and waiting.follow_date = (p_now at time zone preference.timezone)::date
  loop
    desired_at := private.notification_local_time(item.follow_date, time '09:00', item.timezone);
    if desired_at between p_now - interval '30 minutes' and p_now + interval '5 minutes' then
      inserted_id := private.enqueue_notification(
        item.user_id, 'waiting_followup', item.resource_type, item.resource_id,
        desired_at, 'waiting:' || item.resource_type || ':' || item.resource_id::text
          || ':' || item.follow_date::text
      );
      if inserted_id is not null then inserted_count := inserted_count + 1; end if;
    end if;
  end loop;

  for item in
    select * from public.notification_preferences where browser_enabled and shutdown_enabled
  loop
    desired_at := private.notification_local_time(
      (p_now at time zone item.timezone)::date, item.shutdown_reminder_time, item.timezone
    );
    if desired_at between p_now - interval '30 minutes' and p_now + interval '5 minutes' then
      inserted_id := private.enqueue_notification(
        item.user_id, 'daily_shutdown', null, null, desired_at,
        'shutdown:' || (p_now at time zone item.timezone)::date::text
      );
      if inserted_id is not null then inserted_count := inserted_count + 1; end if;
    end if;
  end loop;
  return inserted_count;
end;
$$;
revoke all on function public.enqueue_due_notifications(text, timestamptz) from public, authenticated;
grant execute on function public.enqueue_due_notifications(text, timestamptz) to anon;

-- A delegator is prompted on the due day only for explicitly scheduled tasks;
-- legacy assignments keep the existing lead-time behaviour.
create or replace function public.enqueue_assignment_followups(
  p_dispatch_secret text, p_now timestamptz default now()
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
    and (
      (task.work_dates is null
        and ((coalesce(assignment.due_date, task.due_date) + time '09:00')
          at time zone preference.timezone) - make_interval(mins => preference.deadline_lead_minutes) <= p_now)
      or (task.work_dates is not null
        and coalesce(assignment.due_date, task.due_date) = (p_now at time zone preference.timezone)::date
        and (p_now at time zone preference.timezone)::date = any(task.work_dates)
        and private.notification_local_time((p_now at time zone preference.timezone)::date,
          time '09:00', preference.timezone) <= p_now)
    )
    and coalesce(assignment.due_date, task.due_date) >= (p_now at time zone preference.timezone)::date
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
revoke all on function public.enqueue_assignment_followups(text, timestamptz) from public, authenticated;
grant execute on function public.enqueue_assignment_followups(text, timestamptz) to anon;

-- A daily email digest must not bring Friday's custom-scheduled work forward to Wednesday.
create or replace function public.claim_due_email_digests(
  p_secret text, p_digest_date date, p_limit integer default 10
)
returns table(
  delivery_id uuid, recipient_user_id uuid, recipient_email text,
  display_name text, timezone text, items jsonb
)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.notification_dispatch_authorized(p_secret) then
    raise exception 'NOTIFICATION_DISPATCH_FORBIDDEN';
  end if;
  return query
  with candidate as (
    select profile.user_id, users.email, profile.display_name,
      coalesce(preference.timezone, profile.timezone, 'Asia/Hong_Kong') as timezone,
      coalesce(preference.email_digest_days, 3) as horizon_days,
      coalesce((
        select jsonb_agg(record.item order by record.reminder_date, record.sort_title)
        from (
          select schedule.reminder_date, task.title as sort_title,
            jsonb_build_object(
              'id', task.id, 'kind', 'task', 'title', task.title, 'area', task.area,
              'dueDate', schedule.reminder_date, 'nextAction', task.next_action,
              'followUpCategory', case
                when schedule.reminder_date < p_digest_date then '需要重新安排'
                when task.status = 'waiting' then '等待別人'
                when schedule.reminder_date = p_digest_date then '今日工作'
                else '接近期限'
              end,
              'isOverdue', schedule.reminder_date < p_digest_date
            ) as item
          from public.tasks task
          cross join lateral (
            select case
              when task.work_dates is not null then p_digest_date
              when task.due_date is not null and task.follow_up_date is not null then least(task.due_date, task.follow_up_date)
              else coalesce(task.follow_up_date, task.due_date, task.planned_date)
            end as reminder_date
          ) schedule
          where task.deleted_at is null and task.archived_at is null
            and task.status not in ('done','cancelled')
            and (task.work_dates is null or p_digest_date = any(task.work_dates))
            and schedule.reminder_date between p_digest_date - 30
              and p_digest_date + greatest(coalesce(preference.email_digest_days, 3), 1) - 1
            and (
              task.owner_id = profile.user_id or task.assignee_id = profile.user_id
              or exists (
                select 1 from public.assignments assignment
                where assignment.resource_type = 'task' and assignment.resource_id = task.id
                  and assignment.assigned_to_id = profile.user_id
                  and assignment.status in ('accepted','in_progress','waiting','blocked')
              )
            )
          union all
          select item.due_date as reminder_date, item.title as sort_title,
            jsonb_build_object(
              'id', item.id, 'kind', item.item_type,
              'title', case when item.sensitive then '一項私人工作事項' else item.title end,
              'area', item.area, 'dueDate', item.due_date,
              'nextAction', case when item.sensitive then null else item.next_action end,
              'followUpCategory', case when item.due_date < p_digest_date then '需要重新安排' else '接近期限' end,
              'isOverdue', item.due_date < p_digest_date
            ) as item
          from public.operating_items item
          where item.archived_at is null and item.item_type <> 'client'
            and item.status not in ('completed','cancelled')
            and item.due_date between p_digest_date - 30
              and p_digest_date + greatest(coalesce(preference.email_digest_days, 3), 1) - 1
            and item.owner_id = profile.user_id
          order by reminder_date, sort_title limit 50
        ) record
      ), '[]'::jsonb) as items
    from public.user_profiles profile
    join auth.users users on users.id = profile.user_id and users.email is not null
    left join public.notification_preferences preference on preference.user_id = profile.user_id
    where profile.active and coalesce(preference.email_digest_enabled, true)
  ), claimed as (
    insert into public.email_digest_deliveries(user_id, digest_date, horizon_days, item_count, status)
    select candidate.user_id, p_digest_date, candidate.horizon_days,
      jsonb_array_length(candidate.items), 'processing'
    from candidate where jsonb_array_length(candidate.items) > 0
    order by candidate.user_id
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
    on conflict (user_id, digest_date) do update
    set status = 'processing', attempt_count = public.email_digest_deliveries.attempt_count + 1,
        last_error = null, updated_at = now()
    where public.email_digest_deliveries.status in ('retry','failed')
    returning id, user_id
  )
  select claimed.id, candidate.user_id, candidate.email,
    candidate.display_name, candidate.timezone, candidate.items
  from claimed join candidate on candidate.user_id = claimed.user_id;
end;
$$;
revoke all on function public.claim_due_email_digests(text, date, integer) from public, anon, authenticated;
grant execute on function public.claim_due_email_digests(text, date, integer) to service_role;
