-- Browser/PWA notification queue, private preferences and idempotent dispatch.
-- No record-specific or sensitive content is copied into notification payloads.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  browser_enabled boolean not null default false,
  today_first_enabled boolean not null default true,
  deadline_enabled boolean not null default true,
  waiting_enabled boolean not null default true,
  handover_enabled boolean not null default true,
  focus_enabled boolean not null default true,
  shutdown_enabled boolean not null default false,
  quiet_hours_enabled boolean not null default true,
  quiet_hours_start time not null default '22:00',
  quiet_hours_end time not null default '08:00',
  night_shift_mode boolean not null default false,
  timezone text not null default 'Asia/Hong_Kong',
  today_reminder_time time not null default '09:00',
  shutdown_reminder_time time not null default '21:30',
  deadline_lead_minutes integer not null default 1440,
  private_on_lock_screen boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deadline_lead_check
    check (deadline_lead_minutes between 0 and 10080),
  constraint notification_timezone_length_check
    check (char_length(timezone) between 1 and 100)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_endpoint_https_check
    check (endpoint ~ '^https://'),
  constraint push_endpoint_length_check
    check (char_length(endpoint) between 10 and 4000),
  constraint push_key_length_check
    check (char_length(p256dh) between 40 and 500 and char_length(auth_key) between 10 and 500),
  unique(endpoint)
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  resource_type text,
  resource_id uuid,
  deliver_at timestamptz not null,
  status text not null default 'scheduled',
  dedupe_key text not null,
  generic_title text not null,
  generic_body text not null,
  target_path text not null default '/',
  attempts integer not null default 0,
  processing_started_at timestamptz,
  next_retry_at timestamptz,
  sent_at timestamptz,
  opened_at timestamptz,
  failed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_delivery_kind_check check (kind in (
    'today_first', 'deadline', 'waiting_followup',
    'handover_received', 'handover_accepted', 'handover_information',
    'handover_returned', 'handover_completed',
    'focus_complete', 'daily_shutdown', 'test'
  )),
  constraint notification_delivery_status_check check (status in (
    'scheduled', 'processing', 'retry', 'sent', 'opened', 'failed', 'cancelled'
  )),
  constraint notification_delivery_attempts_check check (attempts between 0 and 10),
  constraint notification_delivery_text_check check (
    char_length(generic_title) between 1 and 100
    and char_length(generic_body) between 1 and 240
    and char_length(target_path) between 1 and 500
    and target_path like '/%'
  ),
  unique(user_id, dedupe_key)
);

create table if not exists public.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.notification_deliveries(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  attempt_number integer not null,
  status text not null default 'processing',
  response_code integer,
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint notification_attempt_status_check
    check (status in ('processing', 'sent', 'retry', 'failed')),
  unique(delivery_id, subscription_id, attempt_number)
);

create index if not exists push_subscriptions_user_active_idx
  on public.push_subscriptions(user_id, last_seen_at desc)
  where revoked_at is null;
create index if not exists notification_deliveries_due_idx
  on public.notification_deliveries(deliver_at, next_retry_at)
  where status in ('scheduled', 'retry');
create index if not exists notification_deliveries_user_history_idx
  on public.notification_deliveries(user_id, created_at desc);
create index if not exists notification_attempts_delivery_idx
  on public.notification_attempts(delivery_id, started_at desc);
create index if not exists notification_attempts_subscription_idx
  on public.notification_attempts(subscription_id, started_at desc);

alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_attempts enable row level security;

create policy notification_preferences_own
  on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_own
  on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy notification_deliveries_select_own
  on public.notification_deliveries for select to authenticated
  using (user_id = (select auth.uid()));

create policy notification_attempts_select_own
  on public.notification_attempts for select to authenticated
  using (exists (
    select 1
    from public.notification_deliveries delivery
    where delivery.id = delivery_id
      and delivery.user_id = (select auth.uid())
  ));

revoke all on public.notification_preferences, public.push_subscriptions,
  public.notification_deliveries, public.notification_attempts from anon;
grant select, insert, update, delete on public.notification_preferences,
  public.push_subscriptions to authenticated;
revoke insert, update, delete on public.push_subscriptions from authenticated;
grant select on public.notification_deliveries to authenticated;
grant select on public.notification_attempts to authenticated;

create table if not exists private.notification_dispatch_config (
  singleton boolean primary key default true check (singleton),
  secret_hash bytea not null,
  updated_at timestamptz not null default now()
);
revoke all on private.notification_dispatch_config from public, anon, authenticated;

create or replace function private.notification_kind_enabled(
  p_user_id uuid,
  p_kind text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select preference.browser_enabled and case
      when p_kind = 'today_first' then preference.today_first_enabled
      when p_kind = 'deadline' then preference.deadline_enabled
      when p_kind = 'waiting_followup' then preference.waiting_enabled
      when p_kind like 'handover_%' then preference.handover_enabled
      when p_kind = 'focus_complete' then preference.focus_enabled
      when p_kind = 'daily_shutdown' then preference.shutdown_enabled
      when p_kind = 'test' then true
      else false
    end
    from public.notification_preferences preference
    where preference.user_id = p_user_id
  ), false);
$$;

create or replace function private.notification_local_time(
  p_date date,
  p_time time,
  p_timezone text
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (p_date::text || ' ' || p_time::text)::timestamp at time zone p_timezone;
$$;

create or replace function private.notification_after_quiet_hours(
  p_user_id uuid,
  p_desired_at timestamptz
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  preference public.notification_preferences%rowtype;
  local_desired timestamp;
  local_date date;
  local_time time;
  allowed_local timestamp;
begin
  select *
  into preference
  from public.notification_preferences
  where user_id = p_user_id;

  if not found or not preference.quiet_hours_enabled
     or preference.quiet_hours_start = preference.quiet_hours_end then
    return p_desired_at;
  end if;

  local_desired := p_desired_at at time zone preference.timezone;
  local_date := local_desired::date;
  local_time := local_desired::time;

  if preference.quiet_hours_start < preference.quiet_hours_end then
    if local_time >= preference.quiet_hours_start
       and local_time < preference.quiet_hours_end then
      allowed_local := local_date + preference.quiet_hours_end;
      return allowed_local at time zone preference.timezone;
    end if;
    return p_desired_at;
  end if;

  if local_time >= preference.quiet_hours_start then
    allowed_local := (local_date + 1) + preference.quiet_hours_end;
    return allowed_local at time zone preference.timezone;
  end if;
  if local_time < preference.quiet_hours_end then
    allowed_local := local_date + preference.quiet_hours_end;
    return allowed_local at time zone preference.timezone;
  end if;
  return p_desired_at;
end;
$$;

create or replace function private.enqueue_notification(
  p_user_id uuid,
  p_kind text,
  p_resource_type text,
  p_resource_id uuid,
  p_desired_at timestamptz,
  p_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_id uuid;
  title_text text;
  body_text text;
  path_text text;
begin
  if not private.notification_kind_enabled(p_user_id, p_kind) then
    return null;
  end if;

  title_text := case p_kind
    when 'today_first' then '今日第一步'
    when 'deadline' then '限期提醒'
    when 'waiting_followup' then '跟進提醒'
    when 'handover_received' then '收到工作交接'
    when 'handover_accepted' then '工作交接已接受'
    when 'handover_information' then '工作交接有新資料'
    when 'handover_returned' then '工作已交回'
    when 'handover_completed' then '交接步驟已完成'
    when 'focus_complete' then '專注時段完成'
    when 'daily_shutdown' then '今日收尾'
    else '通知測試'
  end;
  body_text := case p_kind
    when 'today_first' then '你已確認一項現在可以開始的工作'
    when 'deadline' then '一項工作限期接近'
    when 'waiting_followup' then '一項等待事項已到跟進日期'
    when 'handover_received' then '對方交咗一項工作畀你'
    when 'handover_accepted' then '對方已接受一項工作交接'
    when 'handover_information' then '一項交接有新進度或需要資料'
    when 'handover_returned' then '一項工作已交回上一手'
    when 'handover_completed' then '一項交接步驟已完成'
    when 'focus_complete' then '時間到了，記下 checkpoint 方便下次接續'
    when 'daily_shutdown' then '可以用幾分鐘記下未完工作同下一步'
    else '瀏覽器通知已成功連接'
  end;
  path_text := case
    when p_kind = 'deadline' then '/deadlines'
    when p_kind = 'waiting_followup' then '/workspace/waiting'
    when p_kind like 'handover_%' then '/workspace/handover'
    else '/'
  end;

  insert into public.notification_deliveries(
    user_id, kind, resource_type, resource_id, deliver_at,
    dedupe_key, generic_title, generic_body, target_path
  )
  values (
    p_user_id, p_kind, p_resource_type, p_resource_id,
    private.notification_after_quiet_hours(p_user_id, greatest(p_desired_at, now())),
    left(p_dedupe_key, 500), title_text, body_text, path_text
  )
  on conflict (user_id, dedupe_key) do nothing
  returning id into delivery_id;
  return delivery_id;
end;
$$;

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  subscription_id uuid;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_endpoint !~ '^https://'
     or char_length(p_endpoint) not between 10 and 4000
     or char_length(p_p256dh) not between 40 and 500
     or char_length(p_auth_key) not between 10 and 500
     or char_length(coalesce(p_user_agent, '')) > 500 then
    raise exception 'PUSH_SUBSCRIPTION_INVALID';
  end if;

  insert into public.push_subscriptions(
    user_id, endpoint, p256dh, auth_key, user_agent,
    last_seen_at, revoked_at, updated_at
  )
  values (
    actor, p_endpoint, p_p256dh, p_auth_key, nullif(p_user_agent, ''),
    now(), null, now()
  )
  on conflict (endpoint) do update
  set user_id = actor,
      p256dh = excluded.p256dh,
      auth_key = excluded.auth_key,
      user_agent = excluded.user_agent,
      last_seen_at = now(),
      revoked_at = null,
      updated_at = now()
  returning id into subscription_id;
  return subscription_id;
end;
$$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  changed integer;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.push_subscriptions
  set revoked_at = now(), updated_at = now()
  where user_id = actor and endpoint = p_endpoint and revoked_at is null;
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

create or replace function private.assignment_notification_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient uuid;
  notification_kind text;
  event_key text;
begin
  if tg_op = 'INSERT' then
    recipient := new.assigned_to_id;
    notification_kind := 'handover_received';
    event_key := 'handover-received:' || new.id::text;
  elsif new.status is distinct from old.status then
    recipient := case
      when new.assigned_to_id = new.assigned_by_id then new.assigned_to_id
      when new.status in ('accepted', 'clarification_requested', 'alternative_date_proposed', 'completed', 'returned', 'closed')
        then new.assigned_by_id
      else new.assigned_to_id
    end;
    notification_kind := case new.status
      when 'accepted' then 'handover_accepted'
      when 'clarification_requested' then 'handover_information'
      when 'alternative_date_proposed' then 'handover_information'
      when 'returned' then 'handover_returned'
      when 'completed' then 'handover_completed'
      when 'closed' then 'handover_completed'
      else null
    end;
    event_key := 'handover-status:' || new.id::text || ':' || new.status;
  end if;

  if recipient is not null and notification_kind is not null then
    perform private.enqueue_notification(
      recipient, notification_kind, new.resource_type, new.resource_id,
      now(), event_key
    );
  end if;
  return new;
end;
$$;
drop trigger if exists assignment_notification_trigger on public.assignments;
create trigger assignment_notification_trigger
after insert or update of status on public.assignments
for each row execute function private.assignment_notification_trigger();

create or replace function private.handoff_note_notification_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment_row public.assignments%rowtype;
  recipient uuid;
begin
  select * into assignment_row
  from public.assignments
  where id = new.assignment_id;
  if not found then return new; end if;
  recipient := case
    when new.author_id = assignment_row.assigned_to_id then assignment_row.assigned_by_id
    else assignment_row.assigned_to_id
  end;
  perform private.enqueue_notification(
    recipient,
    case when new.event_type = 'returned' then 'handover_returned'
         when new.event_type in ('step_completed', 'closed') then 'handover_completed'
         else 'handover_information' end,
    'task', new.task_id, now(), 'handover-note:' || new.id::text
  );
  return new;
end;
$$;
drop trigger if exists handoff_note_notification_trigger on public.task_handoff_notes;
create trigger handoff_note_notification_trigger
after insert on public.task_handoff_notes
for each row execute function private.handoff_note_notification_trigger();

create or replace function public.schedule_focus_notification(
  p_task_id uuid,
  p_deliver_at timestamptz,
  p_session_key uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  visible_task uuid;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_key is null or p_deliver_at < now()
     or p_deliver_at > now() + interval '3 hours' then
    raise exception 'NOTIFICATION_SCHEDULE_INVALID';
  end if;
  select id into visible_task
  from public.tasks
  where id = p_task_id;
  if visible_task is null then raise exception 'NOTIFICATION_TASK_FORBIDDEN'; end if;
  return private.enqueue_notification(
    actor, 'focus_complete', 'task', p_task_id, p_deliver_at,
    'focus:' || p_session_key::text
  );
end;
$$;

create or replace function public.cancel_focus_notification(p_delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  changed integer;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.notification_deliveries
  set status = 'cancelled', updated_at = now()
  where id = p_delivery_id
    and user_id = actor
    and kind = 'focus_complete'
    and status in ('scheduled', 'retry');
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

create or replace function public.complete_local_notification(p_delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  changed integer;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.notification_deliveries
  set status = 'sent',
      sent_at = coalesce(sent_at, now()),
      processing_started_at = null,
      next_retry_at = null,
      last_error_code = 'local_service_worker',
      updated_at = now()
  where id = p_delivery_id
    and user_id = actor
    and kind = 'focus_complete'
    and status in ('scheduled', 'processing', 'retry');
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

create or replace function public.mark_notification_opened(p_delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  changed integer;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.notification_deliveries
  set status = 'opened',
      opened_at = coalesce(opened_at, now()),
      updated_at = now()
  where id = p_delivery_id
    and user_id = actor
    and status in ('sent', 'opened');
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

create or replace function public.enqueue_test_notification()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  return private.enqueue_notification(
    actor, 'test', null, null, now(),
    'test:' || gen_random_uuid()::text
  );
end;
$$;

create or replace function private.notification_dispatch_authorized(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    extensions.digest(coalesce(p_secret, ''), 'sha256') =
      (select config.secret_hash
       from private.notification_dispatch_config config
       where config.singleton),
    false
  );
$$;

create or replace function public.enqueue_due_notifications(
  p_dispatch_secret text,
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
      on metadata.user_id = preference.user_id
     and metadata.resource_type = 'task'
     and metadata.planned_date = (p_now at time zone preference.timezone)::date
     and metadata.plan_role = 'now'
    join public.tasks task
      on task.id = metadata.resource_id
     and task.status not in ('done', 'cancelled', 'blocked', 'waiting')
     and task.deleted_at is null and task.archived_at is null
    where preference.browser_enabled and preference.today_first_enabled
  loop
    desired_at := private.notification_local_time(
      (p_now at time zone item.timezone)::date,
      item.today_reminder_time,
      item.timezone
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
      where task.due_date is not null
        and task.status not in ('done', 'cancelled')
        and task.deleted_at is null and task.archived_at is null
      union
      select task.id, assignment.assigned_to_id, task.due_date
      from public.tasks task
      join public.assignments assignment
        on assignment.resource_type = 'task'
       and assignment.resource_id = task.id
       and assignment.status in ('accepted', 'in_progress')
      where task.due_date is not null
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
    desired_at := private.notification_local_time(
      item.due_date, time '09:00', item.timezone
    ) - make_interval(mins => item.deadline_lead_minutes);
    if desired_at between p_now - interval '30 minutes' and p_now + interval '5 minutes' then
      inserted_id := private.enqueue_notification(
        item.user_id, 'deadline', 'task', item.resource_id, desired_at,
        'deadline:' || item.resource_id::text || ':' || item.due_date::text
          || ':' || item.deadline_lead_minutes::text
      );
      if inserted_id is not null then inserted_count := inserted_count + 1; end if;
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
      where operating.status = 'waiting' and operating.due_date is not null
        and operating.archived_at is null
    )
    select preference.*, waiting.resource_type, waiting.resource_id, waiting.follow_date
    from waiting_items waiting
    join public.notification_preferences preference on preference.user_id = waiting.user_id
    where preference.browser_enabled and preference.waiting_enabled
      and waiting.follow_date = (p_now at time zone preference.timezone)::date
  loop
    desired_at := private.notification_local_time(
      item.follow_date, time '09:00', item.timezone
    );
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
    select *
    from public.notification_preferences
    where browser_enabled and shutdown_enabled
  loop
    desired_at := private.notification_local_time(
      (p_now at time zone item.timezone)::date,
      item.shutdown_reminder_time,
      item.timezone
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

create or replace function public.claim_due_notifications(
  p_dispatch_secret text,
  p_batch_id uuid,
  p_limit integer default 50
)
returns table (
  delivery_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_key text,
  generic_title text,
  generic_body text,
  target_path text,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'DISPATCH_FORBIDDEN';
  end if;
  if p_batch_id is null or p_limit < 1 or p_limit > 200 then
    raise exception 'DISPATCH_INVALID';
  end if;

  update public.notification_deliveries
  set status = 'retry',
      next_retry_at = now(),
      processing_started_at = null,
      last_error_code = 'processing_timeout',
      updated_at = now()
  where status = 'processing'
    and processing_started_at < now() - interval '15 minutes';

  update public.notification_deliveries delivery
  set status = 'failed',
      failed_at = now(),
      last_error_code = 'no_active_subscription',
      updated_at = now()
  where delivery.status in ('scheduled', 'retry')
    and delivery.deliver_at <= now()
    and coalesce(delivery.next_retry_at, delivery.deliver_at) <= now()
    and not exists (
      select 1 from public.push_subscriptions subscription
      where subscription.user_id = delivery.user_id
        and subscription.revoked_at is null
    );

  return query
  with claimed as (
    select delivery.id
    from public.notification_deliveries delivery
    where delivery.status in ('scheduled', 'retry')
      and delivery.deliver_at <= now()
      and coalesce(delivery.next_retry_at, delivery.deliver_at) <= now()
      and delivery.attempts < 5
      and exists (
        select 1 from public.push_subscriptions subscription
        where subscription.user_id = delivery.user_id
          and subscription.revoked_at is null
      )
    order by delivery.deliver_at, delivery.id
    for update skip locked
    limit p_limit
  ),
  updated as (
    update public.notification_deliveries delivery
    set status = 'processing',
        processing_started_at = now(),
        attempts = delivery.attempts + 1,
        updated_at = now()
    from claimed
    where delivery.id = claimed.id
    returning delivery.*
  ),
  attempt_rows as (
    insert into public.notification_attempts(
      delivery_id, subscription_id, attempt_number, status
    )
    select updated.id, subscription.id, updated.attempts, 'processing'
    from updated
    join public.push_subscriptions subscription
      on subscription.user_id = updated.user_id
     and subscription.revoked_at is null
    on conflict (delivery_id, subscription_id, attempt_number)
    do update set status = 'processing', started_at = now(), finished_at = null
    returning public.notification_attempts.delivery_id,
      public.notification_attempts.subscription_id,
      public.notification_attempts.attempt_number
  )
  select
    updated.id,
    subscription.id,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth_key,
    updated.generic_title,
    updated.generic_body,
    updated.target_path,
    attempt_rows.attempt_number
  from attempt_rows
  join updated on updated.id = attempt_rows.delivery_id
  join public.push_subscriptions subscription
    on subscription.id = attempt_rows.subscription_id;
end;
$$;

create or replace function public.complete_notification_attempt(
  p_dispatch_secret text,
  p_delivery_id uuid,
  p_subscription_id uuid,
  p_attempt_number integer,
  p_status text,
  p_response_code integer default null,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_attempts integer;
begin
  if not private.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'DISPATCH_FORBIDDEN';
  end if;
  if p_status not in ('sent', 'retry', 'failed') then
    raise exception 'DISPATCH_INVALID';
  end if;

  update public.notification_attempts
  set status = p_status,
      response_code = p_response_code,
      error_code = left(p_error_code, 100),
      finished_at = now()
  where delivery_id = p_delivery_id
    and subscription_id = p_subscription_id
    and attempt_number = p_attempt_number;

  if p_response_code in (404, 410) then
    update public.push_subscriptions
    set revoked_at = now(), updated_at = now()
    where id = p_subscription_id;
  end if;

  if p_status = 'sent' then
    update public.notification_deliveries
    set status = 'sent', sent_at = coalesce(sent_at, now()),
        processing_started_at = null, next_retry_at = null,
        last_error_code = null, updated_at = now()
    where id = p_delivery_id and status <> 'opened';
    return;
  end if;

  select attempts into delivery_attempts
  from public.notification_deliveries
  where id = p_delivery_id;

  if exists (
    select 1 from public.notification_attempts
    where delivery_id = p_delivery_id and status = 'sent'
  ) then
    update public.notification_deliveries
    set status = 'sent', sent_at = coalesce(sent_at, now()),
        processing_started_at = null, next_retry_at = null, updated_at = now()
    where id = p_delivery_id and status <> 'opened';
  elsif not exists (
    select 1 from public.notification_attempts
    where delivery_id = p_delivery_id and status = 'processing'
  ) then
    update public.notification_deliveries
    set status = case when delivery_attempts >= 5 or p_status = 'failed' then 'failed' else 'retry' end,
        failed_at = case when delivery_attempts >= 5 or p_status = 'failed' then now() else failed_at end,
        next_retry_at = case when delivery_attempts >= 5 or p_status = 'failed'
          then null else now() + make_interval(mins => least(60, delivery_attempts * 5)) end,
        processing_started_at = null,
        last_error_code = left(coalesce(p_error_code, 'push_failed'), 100),
        updated_at = now()
    where id = p_delivery_id and status <> 'opened';
  end if;
end;
$$;

revoke all on function public.schedule_focus_notification(uuid, timestamptz, uuid)
  from public, anon;
revoke all on function public.save_push_subscription(text, text, text, text),
  public.remove_push_subscription(text),
  public.cancel_focus_notification(uuid),
  public.complete_local_notification(uuid),
  public.mark_notification_opened(uuid),
  public.enqueue_test_notification()
  from public, anon;
grant execute on function public.schedule_focus_notification(uuid, timestamptz, uuid),
  public.save_push_subscription(text, text, text, text),
  public.remove_push_subscription(text),
  public.cancel_focus_notification(uuid),
  public.complete_local_notification(uuid),
  public.mark_notification_opened(uuid),
  public.enqueue_test_notification()
  to authenticated;

revoke all on function public.enqueue_due_notifications(text, timestamptz),
  public.claim_due_notifications(text, uuid, integer),
  public.complete_notification_attempt(text, uuid, uuid, integer, text, integer, text)
  from public, authenticated;
grant execute on function public.enqueue_due_notifications(text, timestamptz),
  public.claim_due_notifications(text, uuid, integer),
  public.complete_notification_attempt(text, uuid, uuid, integer, text, integer, text)
  to anon;

revoke all on function private.notification_kind_enabled(uuid, text),
  private.notification_local_time(date, time, text),
  private.notification_after_quiet_hours(uuid, timestamptz),
  private.enqueue_notification(uuid, text, text, uuid, timestamptz, text),
  private.assignment_notification_trigger(),
  private.handoff_note_notification_trigger(),
  private.notification_dispatch_authorized(text)
  from public, anon, authenticated;
grant execute on function private.enqueue_notification(uuid, text, text, uuid, timestamptz, text)
  to authenticated;
