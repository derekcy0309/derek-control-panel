-- Recurring expenses stay as rules; each month receives at most one linked payment transaction.
-- Existing transactions are intentionally left untouched.

create table if not exists public.recurring_expense_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('home', 'company')),
  item text not null,
  category text,
  amount numeric(12, 2) not null check (amount > 0),
  payment_method text,
  owner text,
  proof_url text,
  notes text,
  start_month date not null,
  last_payment_month date,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_expense_rules_months_check check (
    last_payment_month is null or last_payment_month >= start_month
  )
);

alter table public.transactions
  add column if not exists recurring_expense_rule_id uuid references public.recurring_expense_rules(id) on delete restrict,
  add column if not exists payment_month date;

create unique index if not exists transactions_recurring_expense_month_unique
  on public.transactions(recurring_expense_rule_id, payment_month)
  where recurring_expense_rule_id is not null and payment_month is not null;

create index if not exists recurring_expense_rules_user_active_month_idx
  on public.recurring_expense_rules(user_id, is_active, start_month, last_payment_month)
  where archived_at is null;

create index if not exists transactions_recurring_expense_lookup_idx
  on public.transactions(user_id, recurring_expense_rule_id, payment_month)
  where recurring_expense_rule_id is not null;

drop trigger if exists set_recurring_expense_rules_updated_at on public.recurring_expense_rules;
create trigger set_recurring_expense_rules_updated_at
before update on public.recurring_expense_rules
for each row execute function public.set_updated_at();

alter table public.recurring_expense_rules enable row level security;

drop policy if exists recurring_expense_rules_select_own on public.recurring_expense_rules;
create policy recurring_expense_rules_select_own on public.recurring_expense_rules
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists recurring_expense_rules_insert_own on public.recurring_expense_rules;
create policy recurring_expense_rules_insert_own on public.recurring_expense_rules
for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists recurring_expense_rules_update_own on public.recurring_expense_rules;
create policy recurring_expense_rules_update_own on public.recurring_expense_rules
for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists recurring_expense_rules_delete_own on public.recurring_expense_rules;
create policy recurring_expense_rules_delete_own on public.recurring_expense_rules
for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.recurring_expense_rules from anon;
grant select, insert, update, delete on table public.recurring_expense_rules to authenticated;

