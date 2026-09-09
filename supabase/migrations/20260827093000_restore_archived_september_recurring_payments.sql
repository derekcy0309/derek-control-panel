-- Repair only the affected September 2026 recurring payments.
-- These rows are the source of truth for a rule's paid state; if they are
-- archived they disappear from both the paid indicator and actual-expense sum.
-- The application now restores an archived monthly payment when it is marked
-- paid again, so future months cannot reproduce this state.
update public.transactions
set
  archived_at = null,
  status = 'paid',
  actual_date = payment_month,
  updated_at = now()
where recurring_expense_rule_id is not null
  and payment_month = date '2026-09-01'
  and status = 'paid'
  and archived_at is not null;
