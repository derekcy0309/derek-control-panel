-- Roll back Today Auto-Plan storage without touching tasks or existing planned dates.
-- Accepted-plan audit rows and the new role metadata are removed by this rollback.

revoke all on function public.accept_today_auto_plan(uuid[], text[], date, uuid)
  from public, anon, authenticated;
drop function if exists public.accept_today_auto_plan(uuid[], text[], date, uuid);

drop table if exists public.today_plan_acceptances;
drop index if exists public.user_planning_today_plan_idx;

alter table public.daily_capacity_checkins
  drop column if exists rest_day;

alter table public.user_planning_metadata
  drop constraint if exists user_planning_plan_source_check,
  drop constraint if exists user_planning_plan_role_check,
  drop column if exists plan_token,
  drop column if exists accepted_at,
  drop column if exists plan_source,
  drop column if exists plan_role;
