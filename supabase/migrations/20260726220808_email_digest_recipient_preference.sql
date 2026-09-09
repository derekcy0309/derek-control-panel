-- Send due digests only for active users who have opted in and have at least
-- one due item they are already authorized to read. This removes the brittle
-- hard-coded Derek email and avoids empty digest emails for retained accounts.
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
        select jsonb_agg(record.item order by record.due_date, record.sort_title)
        from (
          select
            task.due_date,
            task.title as sort_title,
            jsonb_build_object(
              'id', task.id,
              'kind', 'task',
              'title', task.title,
              'area', task.area,
              'dueDate', task.due_date,
              'nextAction', task.next_action
            ) as item
          from public.tasks task
          where task.deleted_at is null and task.archived_at is null
            and task.status not in ('done','cancelled')
            and task.due_date between p_digest_date
              and p_digest_date + greatest(coalesce(preference.email_digest_days, 3), 1) - 1
            and (
              task.owner_id = profile.user_id
              or (
                task.visibility = 'household'
                and task.household_id is not null
                and exists (
                  select 1 from public.household_members member
                  where member.household_id = task.household_id
                    and member.user_id = profile.user_id
                    and member.status = 'accepted'
                )
              )
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
            item.due_date,
            item.title as sort_title,
            jsonb_build_object(
              'id', item.id,
              'kind', item.item_type,
              'title', case when item.sensitive then '一項私人' || case item.area when 'family' then '家庭' when 'work' then '工作' else '個人' end || '事項' else item.title end,
              'area', item.area,
              'dueDate', item.due_date,
              'nextAction', case when item.sensitive then null else item.next_action end
            ) as item
          from public.operating_items item
          where item.archived_at is null
            and item.status not in ('completed','cancelled')
            and item.due_date between p_digest_date
              and p_digest_date + greatest(coalesce(preference.email_digest_days, 3), 1) - 1
            and (
              item.owner_id = profile.user_id
              or (
                item.visibility = 'household'
                and item.household_id is not null
                and exists (
                  select 1 from public.household_members member
                  where member.household_id = item.household_id
                    and member.user_id = profile.user_id
                    and member.status = 'accepted'
                )
              )
            )
          order by due_date, sort_title
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
    select
      candidate.user_id,
      p_digest_date,
      candidate.horizon_days,
      jsonb_array_length(candidate.items),
      'processing'
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
  select claimed.id, candidate.user_id, candidate.email, candidate.display_name, candidate.timezone, candidate.items
  from claimed join candidate on candidate.user_id = claimed.user_id;
end;
$$;
revoke all on function public.claim_due_email_digests(text, date, integer) from public, authenticated;
grant execute on function public.claim_due_email_digests(text, date, integer) to anon, service_role;
