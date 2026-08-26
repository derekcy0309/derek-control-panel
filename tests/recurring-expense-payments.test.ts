import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getCashflowSummary } from "../lib/cashflow.ts";
import type { Transaction } from "../lib/types.ts";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("recurring expenses use a month-only schedule with an optional final payment month", () => {
  const form = read("components/forms/RecurringExpenseForm.tsx");
  const migration = read("supabase/migrations/20260826120000_recurring_expense_payments.sql");
  assert.match(form, /開始付款月份/);
  assert.match(form, /最後付款月份（可留空）/);
  assert.match(form, /type="month"/);
  assert.match(form, /2026-10 起不會再出現/);
  assert.match(migration, /last_payment_month date/);
  assert.match(migration, /transactions_recurring_expense_month_unique/);
  assert.match(migration, /enable row level security/);
});

test("cashflow keeps paid and unpaid entries reversible and separates personal from company", () => {
  const page = read("app/cashflow/page.tsx");
  const card = read("components/items/TransactionCard.tsx");
  const api = read("app/api/control/route.ts");
  assert.match(page, /批量標記已付款/);
  assert.match(page, /個人／家庭恆常支出/);
  assert.match(page, /公司恆常支出/);
  assert.match(page, /個人／家庭臨時支出/);
  assert.match(page, /公司臨時支出/);
  assert.match(page, /改回未付款/);
  assert.match(card, /status: "unpaid", actual_date: null/);
  assert.match(api, /record_recurring_expense_payments/);
  assert.match(api, /paymentMonth = monthValue/);
  assert.match(api, /status: "paid", actual_date: paymentMonth/);
  assert.match(page, /payment_month\?\.slice\(0, 7\) === monthKey/);
});

test("cashflow supports recurring income and one-month-only income and expenses", () => {
  const page = read("app/cashflow/page.tsx");
  const incomeForm = read("components/forms/RecurringIncomeForm.tsx");
  const card = read("components/items/TransactionCard.tsx");
  const migration = read("supabase/migrations/20260826170630_recurring_income_payments.sql");
  const api = read("app/api/control/route.ts");
  assert.match(page, /新增恆常收入/);
  assert.match(page, /新增臨時收入/);
  assert.match(page, /新增臨時支出/);
  assert.match(page, /本月臨時收入/);
  assert.doesNotMatch(page, /全部現金流紀錄/);
  assert.doesNotMatch(card, /複製到下月/);
  assert.match(incomeForm, /最後收款月份（可留空）/);
  assert.match(migration, /create table if not exists public\.recurring_income_rules/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /transactions_recurring_income_month_unique/);
  assert.match(api, /recordRecurringIncomeReceipts/);
});

test("cashflow summary only includes the selected month", () => {
  const base: Transaction = {
    id: "sept", user_id: "u", scope: "home", type: "expense", item: "九月", category: null, amount: 100,
    expected_date: "2026-09-01", actual_date: null, frequency: "monthly", status: "unpaid", payment_method: null,
    owner: null, proof_url: null, notes: null, archived_at: null, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z"
  };
  const summary = getCashflowSummary([base, { ...base, id: "oct", item: "十月", expected_date: "2026-10-01", amount: 200 }], [], "home", "2026-09-01");
  assert.equal(summary.expectedExpense, 100);
});

test("cashflow uses one actual payment date while retaining legacy records", () => {
  const form = read("components/forms/TransactionForm.tsx");
  const card = read("components/items/TransactionCard.tsx");
  assert.doesNotMatch(form, />預計日期</);
  assert.match(form, />實際日期</);
  assert.doesNotMatch(card, /預計日期：/);

  const legacy: Transaction = {
    id: "legacy", user_id: "u", scope: "home", type: "expense", item: "舊紀錄", category: null, amount: 100,
    expected_date: "2026-09-01", actual_date: null, frequency: "monthly", status: "unpaid", payment_method: null,
    owner: null, proof_url: null, notes: null, archived_at: null, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z"
  };
  const actual: Transaction = { ...legacy, id: "actual", expected_date: "2026-08-01", actual_date: "2026-09-01" };
  const summary = getCashflowSummary([legacy, actual], [], "home", "2026-09-01");
  assert.equal(summary.expectedExpense, 200);
});
