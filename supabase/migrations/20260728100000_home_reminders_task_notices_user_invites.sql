-- Home task controls, independent reminders, per-task notice recipients, and
-- Derek's explicit personal calendar/admin profile.

alter table public.user_profiles
  add column if not exists personal_calendar_email text;

create or replace function private.enforce_profile_update_permission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then
    if current_user = 'postgres'
      and new.user_id = old.user_id
      and (to_jsonb(new) - array['is_admin','personal_calendar_email','updated_at'])
        = (to_jsonb(old) - array['is_admin','personal_calendar_email','updated_at'])
    then return new; end if;
    raise exception 'PROFILE_UPDATE_FORBIDDEN';
  end if;
  if actor <> old.user_id then
    if exists (select 1 from public.user_profiles p where p.user_id = actor and p.is_admin and p.active)
      and (to_jsonb(new) - array['must_change_password','updated_at'])
        = (to_jsonb(old) - array['must_change_password','updated_at'])
    then return new; end if;
    raise exception 'PROFILE_UPDATE_FORBIDDEN';
  end if;
  if new.user_id <> old.user_id or new.is_admin <> old.is_admin then
    raise exception 'PROFILE_ADMIN_FIELDS_IMMUTABLE';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_profile_update_permission() from public, anon, authenticated;

update public.user_profiles profile
set personal_calendar_email = 'derekcy0309@gmail.com',
    is_admin = true,
    updated_at = now()
from auth.users account
where account.id = profile.user_id
  and (
    lower(coalesce(account.email, '')) = 'derekcy0309@gmail.com'
    or lower(profile.display_name) like '%derek%'
  );

create or replace function public.participant_profiles()
returns table(user_id uuid, display_name text)
language sql stable security definer
set search_path = ''
as $$
  select distinct profile.user_id, profile.display_name
  from public.user_profiles profile
  where (select auth.uid()) is not null
    and profile.active
    and (
      profile.user_id = (select auth.uid())
      or exists (
        select 1
        from public.user_profiles actor
        where actor.user_id = (select auth.uid())
          and actor.active and actor.is_admin
      )
      or exists (
        select 1
        from public.household_members mine
        join public.household_members partner on partner.household_id = mine.household_id
        where mine.user_id = (select auth.uid()) and mine.status = 'accepted'
          and partner.user_id = profile.user_id and partner.status = 'accepted'
      )
      or exists (
        select 1 from public.share_records share
        where share.revoked_at is null and (
          (share.owner_id = (select auth.uid()) and share.shared_with_user_id = profile.user_id)
          or (share.shared_with_user_id = (select auth.uid()) and share.owner_id = profile.user_id)
        )
      )
      or exists (
        select 1 from public.assignments assignment
        where (assignment.assigned_by_id = (select auth.uid()) and assignment.assigned_to_id = profile.user_id)
           or (assignment.assigned_to_id = (select auth.uid()) and assignment.assigned_by_id = profile.user_id)
      )
    );
$$;
revoke all on function public.participant_profiles() from public, anon;
grant execute on function public.participant_profiles() to authenticated;

create table if not exists public.task_notice_recipients (
  task_id uuid not null references public.tasks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  share_record_id uuid references public.share_records(id) on delete set null,
  owns_share boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (task_id, recipient_id),
  constraint task_notice_not_self check (owner_id <> recipient_id)
);

alter table public.task_notice_recipients enable row level security;
create policy task_notice_recipients_select_participant
  on public.task_notice_recipients for select to authenticated
  using (owner_id = (select auth.uid()) or recipient_id = (select auth.uid()));
revoke all on public.task_notice_recipients from anon, authenticated;
grant select on public.task_notice_recipients to authenticated;

alter table public.notification_preferences
  add column if not exists reminder_enabled boolean not null default true,
  add column if not exists task_notice_enabled boolean not null default true;

alter table public.notification_deliveries
  drop constraint if exists notification_delivery_kind_check;
alter table public.notification_deliveries
  add constraint notification_delivery_kind_check check (kind in (
    'today_first', 'deadline', 'waiting_followup',
    'handover_received', 'handover_accepted', 'handover_information',
    'handover_returned', 'handover_completed',
    'focus_complete', 'daily_shutdown', 'task_notice', 'reminder', 'test'
  ));

create or replace function private.notification_kind_enabled(p_user_id uuid, p_kind text)
returns boolean
language sql stable security definer
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
      when p_kind = 'task_notice' then preference.task_notice_enabled
      when p_kind = 'reminder' then preference.reminder_enabled
      when p_kind = 'test' then true
      else false
    end
    from public.notification_preferences preference
    where preference.user_id = p_user_id
  ), false);
$$;

create or replace function private.enqueue_notification(
  p_user_id uuid, p_kind text, p_resource_type text, p_resource_id uuid,
  p_desired_at timestamptz, p_dedupe_key text
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  delivery_id uuid;
  title_text text;
  body_text text;
  path_text text;
begin
  if not private.notification_kind_enabled(p_user_id, p_kind) then return null; end if;
  title_text := case p_kind
    when 'today_first' then '今日第一步' when 'deadline' then '限期提醒'
    when 'waiting_followup' then '跟進提醒' when 'handover_received' then '收到工作交接'
    when 'handover_accepted' then '工作交接已接受' when 'handover_information' then '工作交接有新資料'
    when 'handover_returned' then '工作已交回' when 'handover_completed' then '交接步驟已完成'
    when 'focus_complete' then '專注時段完成' when 'daily_shutdown' then '今日收尾'
    when 'task_notice' then '任務通知' when 'reminder' then '活動提醒'
    else '通知測試' end;
  body_text := case p_kind
    when 'today_first' then '你已確認一項現在可以開始的工作'
    when 'deadline' then '一項工作限期接近' when 'waiting_followup' then '一項等待事項已到跟進日期'
    when 'handover_received' then '對方交咗一項工作畀你' when 'handover_accepted' then '對方已接受一項工作交接'
    when 'handover_information' then '一項交接有新進度或需要資料' when 'handover_returned' then '一項工作已交回上一手'
    when 'handover_completed' then '一項交接步驟已完成' when 'focus_complete' then '時間到了，記下 checkpoint 方便下次接續'
    when 'daily_shutdown' then '可以用幾分鐘記下未完工作同下一步'
    when 'task_notice' then '有人通知你一項任務' when 'reminder' then '你有一項已安排活動'
    else '瀏覽器通知已成功連接' end;
  path_text := case when p_kind = 'deadline' then '/deadlines'
    when p_kind = 'waiting_followup' then '/workspace/waiting'
    when p_kind like 'handover_%' then '/workspace/handover' else '/' end;
  insert into public.notification_deliveries(
    user_id, kind, resource_type, resource_id, deliver_at,
    dedupe_key, generic_title, generic_body, target_path
  ) values (
    p_user_id, p_kind, p_resource_type, p_resource_id,
    private.notification_after_quiet_hours(p_user_id, greatest(p_desired_at, now())),
    left(p_dedupe_key, 500), title_text, body_text, path_text
  )
  on conflict (user_id, dedupe_key) do nothing returning id into delivery_id;
  return delivery_id;
end;
$$;

create or replace function public.set_task_notice_recipients(
  p_task_id uuid, p_recipient_ids uuid[]
)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  recipient uuid;
  share_id uuid;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.tasks where id = p_task_id and owner_id = actor)
    then raise exception 'TASK_OWNER_REQUIRED'; end if;
  if coalesce(array_length(p_recipient_ids, 1), 0) > 20 then raise exception 'TOO_MANY_RECIPIENTS'; end if;
  if exists (
    select 1 from unnest(coalesce(p_recipient_ids, '{}'::uuid[])) selected
    where selected = actor or not exists (
      select 1 from public.participant_profiles() available where available.user_id = selected
    )
  ) then raise exception 'INVALID_RECIPIENT'; end if;

  update public.share_records share
  set revoked_at = now()
  where share.id in (
    select notice.share_record_id from public.task_notice_recipients notice
    where notice.task_id = p_task_id and notice.owner_id = actor
      and notice.owns_share
      and not (notice.recipient_id = any(coalesce(p_recipient_ids, '{}'::uuid[])))
  ) and share.revoked_at is null and share.share_type = 'reference';

  delete from public.task_notice_recipients
  where task_id = p_task_id and owner_id = actor
    and not (recipient_id = any(coalesce(p_recipient_ids, '{}'::uuid[])));

  foreach recipient in array coalesce(p_recipient_ids, '{}'::uuid[]) loop
    if not exists (
      select 1 from public.task_notice_recipients
      where task_id = p_task_id and recipient_id = recipient
    ) then
      share_id := null;
      select id into share_id from public.share_records
      where resource_type = 'task' and resource_id = p_task_id
        and shared_with_user_id = recipient and revoked_at is null limit 1;
      if share_id is null then
        insert into public.share_records(
          resource_type, resource_id, owner_id, shared_with_user_id,
          permission, share_type, accepted_at
        ) values ('task', p_task_id, actor, recipient, 'view', 'reference', now())
        returning id into share_id;
        insert into public.task_notice_recipients(task_id, owner_id, recipient_id, share_record_id, owns_share)
        values (p_task_id, actor, recipient, share_id, true);
      else
        insert into public.task_notice_recipients(task_id, owner_id, recipient_id, share_record_id, owns_share)
        values (p_task_id, actor, recipient, share_id, false);
      end if;
      perform private.enqueue_notification(
        recipient, 'task_notice', 'task', p_task_id, now(),
        'task-notice:' || p_task_id::text || ':' || recipient::text || ':' || extract(epoch from now())::bigint::text
      );
    end if;
  end loop;
  update public.tasks
  set visibility = case when exists (
    select 1 from public.share_records share
    where share.resource_type = 'task' and share.resource_id = p_task_id
      and share.revoked_at is null
      and (share.expires_at is null or share.expires_at > now())
  ) then 'shared' else 'private' end
  where id = p_task_id and owner_id = actor and visibility in ('private', 'shared');
  return coalesce(array_length(p_recipient_ids, 1), 0);
end;
$$;
revoke all on function public.set_task_notice_recipients(uuid, uuid[]) from public, anon;
grant execute on function public.set_task_notice_recipients(uuid, uuid[]) to authenticated;

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  starts_at timestamptz not null,
  remind_at timestamptz not null,
  timezone text not null default 'Asia/Hong_Kong',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminders_title_check check (char_length(btrim(title)) between 1 and 500),
  constraint reminders_time_check check (remind_at <= starts_at)
);
create table if not exists public.reminder_recipients (
  reminder_id uuid not null references public.reminders(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reminder_id, recipient_id)
);
alter table public.reminders enable row level security;
alter table public.reminder_recipients enable row level security;

create or replace function private.current_user_can_read_reminder(p_reminder_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    exists (
      select 1 from public.reminders reminder
      where reminder.id = p_reminder_id and reminder.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.reminder_recipients recipient
      where recipient.reminder_id = p_reminder_id
        and recipient.recipient_id = (select auth.uid())
    )
  );
$$;
revoke all on function private.current_user_can_read_reminder(uuid) from public, anon;
grant execute on function private.current_user_can_read_reminder(uuid) to authenticated;

create policy reminders_select_participant on public.reminders for select to authenticated
  using ((select private.current_user_can_read_reminder(id)));
create policy reminder_recipients_select_participant on public.reminder_recipients for select to authenticated
  using ((select private.current_user_can_read_reminder(reminder_id)));
revoke all on public.reminders, public.reminder_recipients from anon, authenticated;
grant select on public.reminders, public.reminder_recipients to authenticated;

create or replace function public.save_reminder(
  p_id uuid, p_title text, p_notes text, p_starts_at timestamptz,
  p_remind_at timestamptz, p_recipient_ids uuid[]
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  v_reminder_id uuid;
  recipient uuid;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 500
     or p_starts_at is null or p_remind_at is null or p_remind_at > p_starts_at
    then raise exception 'INVALID_REMINDER'; end if;
  if coalesce(array_length(p_recipient_ids, 1), 0) > 20 then raise exception 'TOO_MANY_RECIPIENTS'; end if;
  if exists (
    select 1 from unnest(coalesce(p_recipient_ids, '{}'::uuid[])) selected
    where selected = actor or not exists (
      select 1 from public.participant_profiles() available where available.user_id = selected
    )
  ) then raise exception 'INVALID_RECIPIENT'; end if;
  if p_id is null then
    insert into public.reminders(owner_id, title, notes, starts_at, remind_at)
    values (actor, btrim(p_title), nullif(btrim(coalesce(p_notes, '')), ''), p_starts_at, p_remind_at)
    returning id into v_reminder_id;
  else
    update public.reminders set title = btrim(p_title),
      notes = nullif(btrim(coalesce(p_notes, '')), ''), starts_at = p_starts_at,
      remind_at = p_remind_at, updated_at = now()
    where id = p_id and owner_id = actor returning id into v_reminder_id;
    if v_reminder_id is null then raise exception 'REMINDER_OWNER_REQUIRED'; end if;
  end if;
  delete from public.reminder_recipients where reminder_id = v_reminder_id;
  foreach recipient in array coalesce(p_recipient_ids, '{}'::uuid[]) loop
    insert into public.reminder_recipients(reminder_id, recipient_id)
    values (v_reminder_id, recipient)
    on conflict do nothing;
  end loop;
  update public.notification_deliveries set status = 'cancelled', updated_at = now()
    where resource_type = 'reminder' and resource_id = v_reminder_id
      and status in ('scheduled', 'retry');
  perform private.enqueue_notification(
    actor, 'reminder', 'reminder', v_reminder_id, p_remind_at,
    'reminder:' || v_reminder_id::text || ':' || actor::text || ':' || extract(epoch from p_remind_at)::bigint::text
  );
  foreach recipient in array coalesce(p_recipient_ids, '{}'::uuid[]) loop
    perform private.enqueue_notification(
      recipient, 'reminder', 'reminder', v_reminder_id, p_remind_at,
      'reminder:' || v_reminder_id::text || ':' || recipient::text || ':' || extract(epoch from p_remind_at)::bigint::text
    );
  end loop;
  return v_reminder_id;
end;
$$;

create or replace function public.delete_reminder(p_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.reminders where id = p_id and owner_id = actor
  ) then raise exception 'REMINDER_OWNER_REQUIRED'; end if;
  update public.notification_deliveries set status = 'cancelled', updated_at = now()
    where resource_type = 'reminder' and resource_id = p_id
      and status in ('scheduled', 'retry');
  delete from public.reminders where id = p_id and owner_id = actor;
  return found;
end;
$$;
revoke all on function public.save_reminder(uuid, text, text, timestamptz, timestamptz, uuid[]),
  public.delete_reminder(uuid) from public, anon;
grant execute on function public.save_reminder(uuid, text, text, timestamptz, timestamptz, uuid[]),
  public.delete_reminder(uuid) to authenticated;
