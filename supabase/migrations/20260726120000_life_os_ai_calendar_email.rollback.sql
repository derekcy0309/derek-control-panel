-- Non-destructive rollback guard for the v1.0 Life OS upgrade.
-- Production rollback requires explicit handling because these tables can hold
-- accepted household memberships, calendar links and private AI plan history.

do $$
begin
  if exists (select 1 from public.household_members where status = 'accepted')
    or exists (select 1 from public.google_calendar_connections)
    or exists (select 1 from public.ai_daily_plans)
    or exists (select 1 from public.email_digest_deliveries)
  then
    raise exception 'life_os_v1_rollback_requires_explicit_data_handling';
  end if;
end $$;

drop function if exists public.complete_due_email_digest(text, uuid, text, text, text);
drop function if exists public.claim_due_email_digests(text, date, integer);
drop function if exists public.read_google_calendar_tokens(uuid);
drop function if exists public.store_google_calendar_tokens(uuid, text, text);
drop function if exists public.household_context();
drop function if exists public.respond_household_invitation(uuid, boolean);
drop function if exists public.invite_household_member(text);

drop table if exists public.email_digest_deliveries;
drop table if exists public.ai_analysis_events;
drop table if exists public.ai_daily_plan_items;
drop table if exists public.ai_daily_plans;
drop table if exists public.calendar_event_links;
drop table if exists private.google_calendar_tokens;
drop table if exists public.google_calendar_connections;

-- Intentionally preserve additive columns and household tables. Removing them
-- after any family item was shared could accidentally reclassify private data.
