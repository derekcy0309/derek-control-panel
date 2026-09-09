-- Suki workflow additions: a safe active-handler transfer and one combined
-- daily follow-up digest. Existing task, finance and handoff rows are retained.

create or replace function public.transfer_task_handoff(
  p_assignment_id uuid,
  p_target_user_id uuid,
  p_note text,
  p_due_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  current_assignment public.assignments%rowtype;
  task_owner uuid;
  next_sequence integer;
  new_assignment_id uuid;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_target_user_id is null or p_target_user_id = actor then
    raise exception 'INVALID_HANDOFF_TARGET';
  end if;
  if nullif(btrim(p_note), '') is null then raise exception 'HANDOFF_NOTE_REQUIRED'; end if;

  select assignment.* into current_assignment
  from public.assignments assignment
  where assignment.id = p_assignment_id
    and assignment.resource_type = 'task'
    and assignment.assigned_to_id = actor
    and assignment.status in ('accepted','in_progress','waiting','blocked')
  for update;
  if not found then raise exception 'HANDOFF_TRANSFER_FORBIDDEN'; end if;

  select task.owner_id into task_owner
  from public.tasks task
  where task.id = current_assignment.resource_id
    and task.deleted_at is null
    and task.archived_at is null
    and task.status not in ('done','cancelled')
  for update;
  if task_owner is null then raise exception 'TASK_HANDOFF_FORBIDDEN'; end if;

  if not exists (
    select 1 from public.participant_profiles() participant
    where participant.user_id = p_target_user_id
  ) then raise exception 'HANDOFF_TARGET_NOT_CONNECTED'; end if;

  if exists (
    select 1 from public.assignments assignment
    where assignment.resource_type = 'task'
      and assignment.resource_id = current_assignment.resource_id
      and assignment.assigned_to_id = p_target_user_id
      and assignment.status in ('pending_acceptance','accepted','in_progress','waiting','blocked')
  ) then raise exception 'TARGET_ALREADY_HANDLING_TASK'; end if;

  update public.assignments
  set status = 'completed',
      completed_steps = completed_steps + 1,
      step_outcome = 'continue',
      next_step = left(btrim(p_note), 5000),
      waiting_until = null,
      completed_at = now(),
      last_note_at = now(),
      updated_at = now()
  where id = current_assignment.id;

  insert into public.task_handoff_notes(
    assignment_id, task_id, author_id, event_type, body, progress, next_step
  ) values (
    current_assignment.id, current_assignment.resource_id, actor, 'step_completed',
    '已轉交下一位現有使用者：' || left(btrim(p_note), 4960),
    current_assignment.progress, left(btrim(p_note), 5000)
  );

  if not exists (
    select 1 from public.share_records share
    where share.resource_type = 'task'
      and share.resource_id = current_assignment.resource_id
      and share.shared_with_user_id = p_target_user_id
      and share.revoked_at is null
  ) then
    insert into public.share_records(
      resource_type, resource_id, owner_id, shared_with_user_id,
      permission, share_type, include_comments
    ) values (
      'task', current_assignment.resource_id, task_owner, p_target_user_id,
      'update_status', 'assignment', true
    );
  end if;

  select coalesce(max(assignment.handoff_sequence), 0) + 1 into next_sequence
  from public.assignments assignment
  where assignment.resource_type = 'task'
    and assignment.resource_id = current_assignment.resource_id;

  insert into public.assignments(
    resource_type, resource_id, assigned_by_id, assigned_to_id,
    status, due_date, instructions, progress, parent_assignment_id,
    handoff_sequence, last_note_at
  ) values (
    'task', current_assignment.resource_id, actor, p_target_user_id,
    'pending_acceptance', p_due_date, left(btrim(p_note), 5000),
    current_assignment.progress, current_assignment.id, next_sequence, now()
  ) returning id into new_assignment_id;

  insert into public.task_handoff_notes(
    assignment_id, task_id, author_id, event_type, body, progress
  ) values (
    new_assignment_id, current_assignment.resource_id, actor, 'assigned',
    left(btrim(p_note), 5000), current_assignment.progress
  );
  return new_assignment_id;
end;
$$;

revoke all on function public.transfer_task_handoff(uuid, uuid, text, date)
  from public, anon, authenticated;
grant execute on function public.transfer_task_handoff(uuid, uuid, text, date)
  to authenticated;

-- A delivery row remains unique per user and local digest date, so RN,
-- materials, client replies, payments and overdue work are combined rather
-- than sent as separate non-urgent emails.
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
                when task.client_update_required or task.task_type = 'follow_up' then '家屬／客戶回覆'
                when task.rn_required or task.task_type = 'rn_coordination' then '護士安排'
                when nullif(btrim(task.materials_required), '') is not null or task.task_type = 'materials' then '物資確認'
                when concat_ws(' ', task.title, task.next_action, task.description) ~* '(付款|收款|款項|發票|invoice|payment|pay)' then '付款跟進'
                else '一般到期'
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
            item.due_date as reminder_date,
            item.title as sort_title,
            jsonb_build_object(
              'id', item.id,
              'kind', item.item_type,
              'title', case when item.sensitive then '一項私人' || case item.area when 'family' then '家庭' when 'work' then '工作' else '個人' end || '事項' else item.title end,
              'area', item.area,
              'dueDate', item.due_date,
              'nextAction', case when item.sensitive then null else item.next_action end,
              'followUpCategory', case when item.due_date < p_digest_date then '需要重新安排' else '一般到期' end,
              'isOverdue', item.due_date < p_digest_date
            ) as item
          from public.operating_items item
          where item.archived_at is null
            and item.status not in ('completed','cancelled')
            and item.due_date between p_digest_date - 30
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
          union all
          select
            cashflow.expected_date as reminder_date,
            cashflow.item as sort_title,
            jsonb_build_object(
              'id', cashflow.id,
              'kind', 'payment',
              'title', cashflow.item,
              'area', case when cashflow.scope = 'company' then 'work' else 'personal' end,
              'dueDate', cashflow.expected_date,
              'nextAction', case when cashflow.type = 'income' then '確認收款或跟進付款安排' else '確認付款狀態或安排處理' end,
              'followUpCategory', case when cashflow.expected_date < p_digest_date then '需要重新安排' else '付款跟進' end,
              'isOverdue', cashflow.expected_date < p_digest_date
            ) as item
          from public.transactions cashflow
          where cashflow.user_id = profile.user_id
            and cashflow.archived_at is null
            and cashflow.expected_date between p_digest_date - 30
              and p_digest_date + greatest(coalesce(preference.email_digest_days, 3), 1) - 1
            and (
              (cashflow.type = 'income' and cashflow.status in ('expected','delayed','problem'))
              or (cashflow.type = 'expense' and cashflow.status in ('unpaid','problem'))
            )
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
