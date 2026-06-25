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
  const scoped = transactions.filter((item) => item.scope === scope && item.status !== "cancelled");
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
