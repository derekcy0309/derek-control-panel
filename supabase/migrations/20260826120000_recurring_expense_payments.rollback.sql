-- Rollback only removes the new recurring-expense feature. Existing transactions remain.
drop trigger if exists set_recurring_expense_rules_updated_at on public.recurring_expense_rules;
drop policy if exists recurring_expense_rules_select_own on public.recurring_expense_rules;
drop policy if exists recurring_expense_rules_insert_own on public.recurring_expense_rules;
drop policy if exists recurring_expense_rules_update_own on public.recurring_expense_rules;
drop policy if exists recurring_expense_rules_delete_own on public.recurring_expense_rules;
drop index if exists public.transactions_recurring_expense_month_unique;
drop index if exists public.recurring_expense_rules_user_active_month_idx;
drop index if exists public.transactions_recurring_expense_lookup_idx;
alter table public.transactions drop column if exists recurring_expense_rule_id, drop column if exists payment_month;
drop table if exists public.recurring_expense_rules;
