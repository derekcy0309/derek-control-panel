-- Personal-work-only follow-up metadata and digest. This migration is
-- additive: legacy columns and rows remain untouched for recovery.

alter table public.tasks
  add column if not exists waiting_for text,
  add column if not exists waiting_on text;

comment on column public.tasks.waiting_for is 'Free-text name or role currently being waited on.';
comment on column public.tasks.waiting_on is 'Short description of the result, reply, or information being waited on.';

create index if not exists tasks_waiting_follow_up_idx
  on public.tasks (coalesce(assignee_id, owner_id), follow_up_date, updated_at desc)
  where status = 'waiting' and deleted_at is null and archived_at is null;

-- Keep the existing one-delivery-per-user-per-day claim and authorization
-- contract, but exclude finance and retired operational categories from the
-- personal work digest.
create or replace function public.claim_due_email_digests(
  p_secret text,
  p_digest_date date,
  p_limit integer default 10
)
returns table(
  delivery_id uuid,
  recipient_user_id uuid,
  recipient_email text,
  display_name text,
  timezone text,
  items jsonb
)
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.notification_dispatch_authorized(p_secret) then
    raise exception 'NOTIFICATION_DISPATCH_FORBIDDEN';
  end if;
  return query
  with candidate as (
    select
      profile.user_id,
      users.email,
      profile.display_name,
      coalesce(preference.timezone, profile.timezone, 'Asia/Hong_Kong') as timezone,
      coalesce(preference.email_digest_days, 3) as horizon_days,
      coalesce((
        select jsonb_agg(record.item order by record.reminder_date, record.sort_title)
        from (
          select
            schedule.reminder_date,
            task.title as sort_title,
            jsonb_build_object(
              'id', task.id,
              'kind', 'task',
              'title', task.title,
              'area', task.area,
              'dueDate', schedule.reminder_date,
              'nextAction', task.next_action,
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
              when task.due_date is not null and task.follow_up_date is not null then least(task.due_date, task.follow_up_date)
              else coalesce(task.follow_up_date, task.due_date, task.planned_date)
            end as reminder_date
          ) schedule
          where task.deleted_at is null and task.archived_at is null
            and task.status not in ('done','cancelled')
            and schedule.reminder_date between p_digest_date - 30
              and p_digest_date + greatest(coalesce(preference.email_digest_days, 3), 1) - 1
            and (
              task.owner_id = profile.user_id
              or task.assignee_id = profile.user_id
              or exists (
                select 1 from public.assignments assignment
                where assignment.resource_type = 'task'
                  and assignment.resource_id = task.id
                  and assignment.assigned_to_id = profile.user_id
                  and assignment.status in ('accepted','in_progress','waiting','blocked')
              )
            )
          union all
          select
            item.due_date as reminder_date,
            item.title as sort_title,
            jsonb_build_object(
              'id', item.id,
              'kind', item.item_type,
              'title', case when item.sensitive then '一項私人工作事項' else item.title end,
              'area', item.area,
              'dueDate', item.due_date,
              'nextAction', case when item.sensitive then null else item.next_action end,
              'followUpCategory', case when item.due_date < p_digest_date then '需要重新安排' else '接近期限' end,
              'isOverdue', item.due_date < p_digest_date
            ) as item
          from public.operating_items item
          where item.archived_at is null
            and item.item_type <> 'client'
            and item.status not in ('completed','cancelled')
            and item.due_date between p_digest_date - 30
              and p_digest_date + greatest(coalesce(preference.email_digest_days, 3), 1) - 1
            and item.owner_id = profile.user_id
          order by reminder_date, sort_title
          limit 50
        ) record
      ), '[]'::jsonb) as items
    from public.user_profiles profile
    join auth.users users on users.id = profile.user_id and users.email is not null
    left join public.notification_preferences preference on preference.user_id = profile.user_id
    where profile.active
      and coalesce(preference.email_digest_enabled, true)
  ), claimed as (
    insert into public.email_digest_deliveries(
      user_id, digest_date, horizon_days, item_count, status
    )
    select candidate.user_id, p_digest_date, candidate.horizon_days,
      jsonb_array_length(candidate.items), 'processing'
    from candidate
    where jsonb_array_length(candidate.items) > 0
    order by candidate.user_id
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
    on conflict (user_id, digest_date) do update
    set status = 'processing',
        attempt_count = public.email_digest_deliveries.attempt_count + 1,
        last_error = null,
        updated_at = now()
    where public.email_digest_deliveries.status in ('retry','failed')
    returning id, user_id
  )
  select claimed.id, candidate.user_id, candidate.email,
    candidate.display_name, candidate.timezone, candidate.items
  from claimed join candidate on candidate.user_id = claimed.user_id;
end;
$$;

revoke all on function public.claim_due_email_digests(text, date, integer)
  from public, authenticated;
grant execute on function public.claim_due_email_digests(text, date, integer)
  to anon, service_role;

