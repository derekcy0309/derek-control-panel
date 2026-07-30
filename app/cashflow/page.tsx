"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Archive, Plus } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Modal } from "@/components/Modal";
import { TransactionForm } from "@/components/forms/TransactionForm";
import { TransactionCard } from "@/components/items/TransactionCard";
import { Button } from "@/components/ui/Button";
import { getCashflowSummary } from "@/lib/cashflow";
import { currentMonth, formatCurrency, isWithinDays } from "@/lib/date";
import { scopeLabels, transactionTypeLabels } from "@/lib/labels";
import { controlAction, loadArchivedTransactions } from "@/lib/control-api";
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
  const [showArchived, setShowArchived] = useState(false);
  const [archivedTransactions, setArchivedTransactions] = useState<Transaction[] | null>(null);
  const [archivedPage, setArchivedPage] = useState(1);
  const [hasMoreArchived, setHasMoreArchived] = useState(false);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState("");
  const [archiveFeedback, setArchiveFeedback] = useState("");

  const activeTransactions = useMemo(() => data.transactions.filter((item) => !item.archived_at), [data.transactions]);

  const loadArchived = useCallback(async (page: number, append = false) => {
    setArchivedLoading(true);
    setArchivedError("");
    try {
      const result = await loadArchivedTransactions(page);
      setArchivedTransactions((current) => append ? [...(current ?? []), ...result.transactions] : result.transactions);
      setArchivedPage(result.page);
      setHasMoreArchived(result.hasMore);
    } catch (caught) {
      setArchivedError(caught instanceof Error ? caught.message : "未能讀取已封存交易，請稍後重試。");
    } finally {
      setArchivedLoading(false);
    }
  }, []);

  async function toggleArchived() {
    const nextShowArchived = !showArchived;
    setShowArchived(nextShowArchived);
    if (nextShowArchived && archivedTransactions === null) await loadArchived(1);
  }

  function handleActiveTransactionChanged() {
    void reload();
    if (showArchived) void loadArchived(1);
  }

  async function restoreTransaction(transaction: Transaction) {
    setArchivedError("");
    setArchiveFeedback("");
    try {
      await controlAction("save_transaction", { ...transaction, archived_at: null });
      await Promise.all([reload(), loadArchived(1)]);
      setArchiveFeedback(`「${transaction.item}」已還原，現已重新計入現金流。`);
    } catch (caught) {
      setArchivedError(caught instanceof Error ? caught.message : "還原失敗，原有封存資料沒有被刪除，請再試一次。");
    }
  }

  const upcomingPayments = useMemo(
    () =>
      activeTransactions.filter(
        (item) => item.type === "expense" && item.status !== "paid" && item.status !== "cancelled" && isWithinDays(item.expected_date, 7)
      ),
    [activeTransactions]
  );
  const monthKey = month.slice(0, 7);
  const thisMonthExpenses = useMemo(
    () => activeTransactions.filter((item) => item.type === "expense" && item.expected_date?.slice(0, 7) === monthKey),
    [activeTransactions, monthKey]
  );
  const paidThisMonth = useMemo(
    () => thisMonthExpenses.filter((item) => item.status === "paid"),
    [thisMonthExpenses]
  );
  const unpaidThisMonth = useMemo(
    () => thisMonthExpenses.filter((item) => !["paid", "cancelled", "skipped"].includes(item.status)),
    [thisMonthExpenses]
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
          <Button variant="secondary" onClick={() => void toggleArchived()} aria-expanded={showArchived}>
            <Archive className="h-5 w-5" />
            {showArchived ? "收起已封存" : "查看已封存"}
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
        <CashflowScope scope="home" month={month} userId={userId} transactions={activeTransactions} balances={data.balances} reload={reload} />
        <CashflowScope scope="company" month={month} userId={userId} transactions={activeTransactions} balances={data.balances} reload={reload} />
      </section>

      <section className="panel p-4">
        <div>
          <h3 className="text-xl font-bold text-ink">本月付款狀態</h3>
          <p className="mt-1 text-sm text-slate-600">按預計日期分開顯示，已取消、跳過及已封存項目不會列入未付款。</p>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <PaymentGroup title="本月已付款" items={paidThisMonth} emptyMessage="本月暫時沒有已付款支出。" onChanged={handleActiveTransactionChanged} onEdit={setEditingTransaction} />
          <PaymentGroup title="本月未付款" items={unpaidThisMonth} emptyMessage="本月暫時沒有未付款支出。" onChanged={handleActiveTransactionChanged} onEdit={setEditingTransaction} highlight />
        </div>
      </section>

      <section className="panel p-4">
        <h3 className="mb-4 text-xl font-bold text-ink">未來 7 日要付款</h3>
        <div className="grid gap-4">
          {upcomingPayments.length ? (
            upcomingPayments.map((item) => (
              <TransactionCard key={item.id} transaction={item} onChanged={handleActiveTransactionChanged} onEdit={setEditingTransaction} highlight />
            ))
          ) : (
            <p className="rounded-lg bg-emerald-50 p-4 text-base font-semibold text-emerald-800">未來 7 日沒有需要付款的支出。</p>
          )}
        </div>
      </section>

      <section className="grid gap-4">
        <h3 className="text-xl font-bold text-ink">全部現金流紀錄</h3>
        {activeTransactions.map((item) => (
          <TransactionCard key={item.id} transaction={item} onChanged={handleActiveTransactionChanged} onEdit={setEditingTransaction} />
        ))}
      </section>

      {showArchived ? (
        <section className="panel p-4" aria-live="polite">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-xl font-bold text-ink">已封存交易</h3>
              <p className="mt-1 text-sm text-slate-600">封存項目不會計入收入、支出、期末結餘或付款提醒；你可以隨時還原。</p>
            </div>
            <Button variant="secondary" disabled={archivedLoading} onClick={() => void loadArchived(1)}>
              {archivedLoading ? "讀取中..." : "重新整理"}
            </Button>
          </div>
          {archiveFeedback ? <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{archiveFeedback}</p> : null}
          {archivedError ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">{archivedError}</p> : null}
          {archivedLoading && archivedTransactions === null ? <p className="mt-4 text-sm text-slate-600">正在讀取已封存交易…</p> : null}
          {archivedTransactions?.length ? (
            <div className="mt-4 grid gap-4">
              {archivedTransactions.map((item) => (
                <TransactionCard key={item.id} transaction={item} archived onChanged={handleActiveTransactionChanged} onRestore={restoreTransaction} />
              ))}
              {hasMoreArchived ? (
                <Button variant="secondary" disabled={archivedLoading} onClick={() => void loadArchived(archivedPage + 1, true)}>
                  {archivedLoading ? "讀取中..." : "載入更多已封存交易"}
                </Button>
              ) : null}
            </div>
          ) : archivedTransactions && !archivedLoading ? (
            <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-600">暫時沒有已封存交易。</p>
          ) : null}
        </section>
      ) : null}

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

function PaymentGroup({
  title,
  items,
  emptyMessage,
  onChanged,
  onEdit,
  highlight = false
}: {
  title: string;
  items: Transaction[];
  emptyMessage: string;
  onChanged: () => void;
  onEdit: (transaction: Transaction) => void;
  highlight?: boolean;
}) {
  return (
    <section className="rounded-xl bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-lg font-bold text-ink">{title}</h4>
        <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700">{items.length} 項</span>
      </div>
      <div className="mt-3 grid gap-3">
        {items.length ? items.map((item) => (
          <TransactionCard key={item.id} transaction={item} onChanged={onChanged} onEdit={onEdit} highlight={highlight} />
        )) : <p className="rounded-lg bg-white p-4 text-sm font-semibold text-slate-600">{emptyMessage}</p>}
      </div>
    </section>
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
