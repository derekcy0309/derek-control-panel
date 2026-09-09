import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getCashflowSummary } from "../lib/cashflow.ts";
import type { Transaction } from "../lib/types.ts";

const activeIncome: Transaction = {
  id: "income", user_id: "user", scope: "home", type: "income", item: "活躍收入", category: null,
  amount: 1000, expected_date: "2026-07-01", actual_date: null, frequency: "one_time", status: "expected",
  payment_method: null, owner: null, proof_url: null, notes: null, archived_at: null,
  created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z"
};

test("archived cashflow transactions do not affect income, expenses, or projected balance", () => {
  const archivedExpense: Transaction = {
    ...activeIncome,
    id: "archived-expense",
    type: "expense",
    item: "已封存支出",
    amount: 300,
    status: "unpaid",
    archived_at: "2026-07-02T00:00:00.000Z"
  };
  const summary = getCashflowSummary([activeIncome, archivedExpense], [{ id: "balance", user_id: "user", scope: "home", month: "2026-07-01", opening_balance: 100, archived_at: null, created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" }], "home", "2026-07-01");

  assert.equal(summary.expectedIncome, 1000);
  assert.equal(summary.expectedExpense, 0);
  assert.equal(summary.projectedBalance, 1100);
});

test("Cashflow exposes an archived list and the API protects owner-only recovery", async () => {
  const [cashflowPage, transactionCard, controlApi] = await Promise.all([
    readFile(new URL("../app/cashflow/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/items/TransactionCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/control/route.ts", import.meta.url), "utf8")
  ]);

  assert.match(cashflowPage, /查看已封存/);
  assert.match(cashflowPage, /還原，現已重新計入現金流/);
  assert.match(cashflowPage, /本月已付款/);
  assert.match(cashflowPage, /本月未付款/);
  assert.match(cashflowPage, /\["paid", "cancelled", "skipped"\]/);
  assert.match(transactionCard, /還原到現金流/);
  assert.match(controlApi, /view === "archived_transactions"/);
  assert.match(controlApi, /\.eq\("user_id", user\.id\)\s*\.not\("archived_at", "is", null\)/);
  assert.match(controlApi, /Object\.prototype\.hasOwnProperty\.call\(body, "archived_at"\)/);
  assert.match(controlApi, /"封存現金流項目"/);
  assert.match(controlApi, /"還原現金流項目"/);
});
