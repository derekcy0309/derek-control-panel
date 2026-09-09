import type { Balance, Scope, Transaction } from "@/lib/types";

export type CashflowSummary = {
  openingBalance: number;
  actualIncome: number;
  expectedIncome: number;
  actualExpense: number;
  expectedExpense: number;
  projectedBalance: number;
};

export function getCashflowSummary(transactions: Transaction[], balances: Balance[], scope: Scope, month: string): CashflowSummary {
  // Keep summaries safe even when a caller has loaded archived rows for recovery.
  // The normal bootstrap query already excludes them, but archived cashflow items
  // must never contribute to income, expense, or projected balance.
  const monthKey = month.slice(0, 7);
  const scoped = transactions.filter((item) =>
    item.scope === scope
    && !item.archived_at
    && item.status !== "cancelled"
    && (item.actual_date ?? item.expected_date)?.slice(0, 7) === monthKey
  );
  const openingBalance = balances.find((item) => item.scope === scope && item.month === month)?.opening_balance ?? 0;
  const actualIncome = sum(scoped.filter((item) => item.type === "income" && item.status === "received"));
  const expectedIncome = sum(scoped.filter((item) => item.type === "income"));
  const actualExpense = sum(scoped.filter((item) => item.type === "expense" && item.status === "paid"));
  const expectedExpense = sum(scoped.filter((item) => item.type === "expense"));

  return {
    openingBalance,
    actualIncome,
    expectedIncome,
    actualExpense,
    expectedExpense,
    projectedBalance: openingBalance + expectedIncome - expectedExpense
  };
}

function sum(items: Transaction[]) {
  return items.reduce((total, item) => total + Number(item.amount || 0), 0);
}
