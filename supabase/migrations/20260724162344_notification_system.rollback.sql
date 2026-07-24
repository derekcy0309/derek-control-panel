-- Disable the scheduler before removing notification-only objects.
do $$
declare job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'dcp-notification-dispatch';
  if job_id is not null then perform cron.unschedule(job_id); end if;
exception when undefined_table then null;
end $$;

drop trigger if exists handoff_note_notification_trigger on public.task_handoff_notes;
drop trigger if exists assignment_notification_trigger on public.assignments;

drop function if exists public.complete_notification_attempt(text, uuid, uuid, integer, text, integer, text);
drop function if exists public.claim_due_notifications(text, uuid, integer);
drop function if exists public.enqueue_due_notifications(text, timestamptz);
drop function if exists public.enqueue_test_notification();
drop function if exists public.mark_notification_opened(uuid);
drop function if exists public.complete_local_notification(uuid);
drop function if exists public.cancel_focus_notification(uuid);
drop function if exists public.schedule_focus_notification(uuid, timestamptz, uuid);
drop function if exists public.remove_push_subscription(text);
drop function if exists public.save_push_subscription(text, text, text, text);
drop function if exists private.handoff_note_notification_trigger();
drop function if exists private.assignment_notification_trigger();
drop function if exists private.notification_dispatch_authorized(text);
drop function if exists private.enqueue_notification(uuid, text, text, uuid, timestamptz, text);
drop function if exists private.notification_after_quiet_hours(uuid, timestamptz);
drop function if exists private.notification_local_time(date, time, text);
drop function if exists private.notification_kind_enabled(uuid, text);

drop table if exists public.notification_attempts;
drop table if exists public.notification_deliveries;
drop table if exists public.push_subscriptions;
drop table if exists public.notification_preferences;
drop table if exists private.notification_dispatch_config;

-- pg_cron and pg_net may be shared by other features, so rollback leaves extensions enabled.
