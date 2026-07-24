-- Low-pressure, owner-only weekly review records. The review stores only
-- confirmed reflections and a compact non-sensitive snapshot; it never
-- changes tasks, assignments, dates, or handoffs by itself.
create table if not exists public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  next_week_outcomes text[] not null default '{}',
  next_week_available_minutes integer,
  rebalancing_note text,
  next_minimum_action text,
  reflection text,
  review_snapshot jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_reviews_user_week_unique unique (user_id, week_start),
  constraint weekly_reviews_outcomes_limit check (cardinality(next_week_outcomes) <= 3),
  constraint weekly_reviews_outcomes_nonempty check (not ('' = any(next_week_outcomes))),
  constraint weekly_reviews_available_minutes_range check (
    next_week_available_minutes is null
    or next_week_available_minutes between 0 and 10080
  ),
  constraint weekly_reviews_snapshot_object check (jsonb_typeof(review_snapshot) = 'object')
);

create index if not exists weekly_reviews_user_week_idx
  on public.weekly_reviews(user_id, week_start desc);

create or replace function private.validate_weekly_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or new.user_id <> (select auth.uid()) then
    raise exception 'WEEKLY_REVIEW_FORBIDDEN';
  end if;
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.week_start <> old.week_start) then
    raise exception 'WEEKLY_REVIEW_IDENTITY_IMMUTABLE';
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' and new.status <> 'completed' then
    raise exception 'WEEKLY_REVIEW_COMPLETION_IMMUTABLE';
  end if;
  if new.status = 'completed' and nullif(btrim(coalesce(new.next_minimum_action, '')), '') is null then
    raise exception 'WEEKLY_REVIEW_NEXT_ACTION_REQUIRED';
  end if;
  new.updated_at := now();
  if new.status = 'completed' and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists validate_weekly_review_trigger on public.weekly_reviews;
create trigger validate_weekly_review_trigger
before insert or update on public.weekly_reviews
for each row execute function private.validate_weekly_review();
revoke all on function private.validate_weekly_review() from public, anon, authenticated;

alter table public.weekly_reviews enable row level security;

drop policy if exists weekly_reviews_select_own on public.weekly_reviews;
create policy weekly_reviews_select_own
on public.weekly_reviews for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists weekly_reviews_insert_own on public.weekly_reviews;
create policy weekly_reviews_insert_own
on public.weekly_reviews for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists weekly_reviews_update_own on public.weekly_reviews;
create policy weekly_reviews_update_own
on public.weekly_reviews for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

revoke all on table public.weekly_reviews from anon;
grant select, insert, update on table public.weekly_reviews to authenticated;
