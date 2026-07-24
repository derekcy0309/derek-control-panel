"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Plus } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Modal } from "@/components/Modal";
import { TransactionForm } from "@/components/forms/TransactionForm";
import { TransactionCard } from "@/components/items/TransactionCard";
import { Button } from "@/components/ui/Button";
import { getCashflowSummary } from "@/lib/cashflow";
import { currentMonth, formatCurrency, isWithinDays } from "@/lib/date";
import { scopeLabels, transactionTypeLabels } from "@/lib/labels";
import { controlAction } from "@/lib/control-api";
import type { Scope, Transaction } from "@/lib/types";
import { useAppData } from "@/hooks/useAppData";

export default function CashflowPage() {
  return (
    <AuthGate>
      <CashflowContent />
    </AuthGate>
  );
}

function CashflowContent() {
  const { data, userId, loading, error, reload } = useAppData();
  const [addingType, setAddingType] = useState<"income" | "expense" | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [month, setMonth] = useState(currentMonth());

  const upcomingPayments = useMemo(
    () =>
      data.transactions.filter(
        (item) => item.type === "expense" && item.status !== "paid" && item.status !== "cancelled" && isWithinDays(item.expected_date, 7)
      ),
    [data.transactions]
  );

  if (loading || error || !userId) return <LoadingState error={error} />;

  return (
    <div className="space-y-5">
      <section className="flex flex-col justify-between gap-4 rounded-2xl bg-white p-5 shadow-soft sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold text-indigo-600">家庭與公司分開看</p>
          <h2 className="mt-1 text-2xl font-bold text-ink">現金流</h2>
          <p className="mt-2 text-base text-slate-600">期初結餘 + 預計收入 - 預計支出 = 預計期末結餘。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setAddingType("income")}>
            <Plus className="h-5 w-5" />
            新增收入
          </Button>
          <Button variant="secondary" onClick={() => setAddingType("expense")}>
            <Plus className="h-5 w-5" />
            新增支出
          </Button>
        </div>
      </section>

      <section className="panel p-4">
        <label className="block max-w-xs">
          <span className="label">月份</span>
          <input className="field mt-2" type="month" value={month.slice(0, 7)} onChange={(event) => setMonth(`${event.target.value}-01`)} />
        </label>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <CashflowScope scope="home" month={month} userId={userId} transactions={data.transactions} balances={data.balances} reload={reload} />
        <CashflowScope scope="company" month={month} userId={userId} transactions={data.transactions} balances={data.balances} reload={reload} />
      </section>

      <section className="panel p-4">
        <h3 className="mb-4 text-xl font-bold text-ink">未來 7 日要付款</h3>
        <div className="grid gap-4">
          {upcomingPayments.length ? (
            upcomingPayments.map((item) => (
              <TransactionCard key={item.id} transaction={item} onChanged={reload} onEdit={setEditingTransaction} highlight />
            ))
          ) : (
            <p className="rounded-lg bg-emerald-50 p-4 text-base font-semibold text-emerald-800">未來 7 日沒有需要付款的支出。</p>
          )}
        </div>
      </section>

      <section className="grid gap-4">
        {data.transactions.map((item) => (
          <TransactionCard key={item.id} transaction={item} onChanged={reload} onEdit={setEditingTransaction} />
        ))}
      </section>

      {addingType ? (
        <Modal title={addingType === "income" ? "新增收入" : "新增支出"} onClose={() => setAddingType(null)}>
          <TransactionForm userId={userId} forcedType={addingType} onSaved={() => finish(reload, () => setAddingType(null))} onCancel={() => setAddingType(null)} />
        </Modal>
      ) : null}

      {editingTransaction ? (
        <Modal title="修改收入支出" onClose={() => setEditingTransaction(null)}>
          <TransactionForm
            userId={userId}
            initialTransaction={editingTransaction}
            onSaved={() => finish(reload, () => setEditingTransaction(null))}
            onCancel={() => setEditingTransaction(null)}
          />
        </Modal>
      ) : null}
    </div>
  );
}

function CashflowScope({
  scope,
  month,
  userId,
  transactions,
  balances,
  reload
}: {
  scope: Scope;
  month: string;
  userId: string;
  transactions: import("@/lib/types").Transaction[];
  balances: import("@/lib/types").Balance[];
  reload: () => void;
}) {
  const summary = getCashflowSummary(transactions, balances, scope, month);
  const [openingBalance, setOpeningBalance] = useState(String(summary.openingBalance));

  useEffect(() => {
    setOpeningBalance(String(summary.openingBalance));
  }, [summary.openingBalance]);

  async function saveOpeningBalance() {
    await controlAction("save_balance", { scope, month, opening_balance: Number(openingBalance || 0) });
    reload();
  }

  return (
    <div className={scope === "home" ? "rounded-xl bg-home-50 p-5 shadow-soft" : "rounded-xl bg-work-50 p-5 shadow-soft"}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl font-bold text-ink">{scopeLabels[scope]}現金流</h3>
        <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700">{month.slice(0, 7)}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Metric label="實際收入" value={summary.actualIncome} />
        <Metric label="預計收入" value={summary.expectedIncome} />
        <Metric label="實際支出" value={summary.actualExpense} />
        <Metric label="預計支出" value={summary.expectedExpense} />
      </div>
      <div className="mt-4 rounded-lg bg-white p-4">
        <label>
          <span className="label">期初結餘</span>
          <div className="mt-2 flex gap-2">
            <input className="field" type="number" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} />
            <Button type="button" variant="secondary" onClick={saveOpeningBalance}>
              儲存
            </Button>
          </div>
        </label>
      </div>
      <div className="mt-4 rounded-lg bg-white p-4">
        <p className="text-base font-semibold text-slate-600">預計期末結餘</p>
        <p className={clsx("mt-1 text-3xl font-bold", summary.projectedBalance < 0 ? "text-red-700" : "text-emerald-700")}>
          {formatCurrency(summary.projectedBalance)}
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white p-4">
      <p className="text-sm font-semibold text-slate-600">{label}</p>
      <p className="mt-1 text-xl font-bold text-ink">{formatCurrency(value)}</p>
    </div>
  );
}

function finish(reload: () => void, close: () => void) {
  reload();
  close();
}
