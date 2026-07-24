-- The original routine used its RETURNS TABLE output-column names in the
-- conflict target. PL/pgSQL therefore treated `delivery_id` et al. as
-- ambiguous. Name the existing unique constraint instead, so a scheduled
-- notification can be safely claimed more than once by an idempotent worker.
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
    on conflict on constraint notification_attempts_delivery_id_subscription_id_attempt_n_key
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
