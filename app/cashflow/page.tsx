"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Archive, CheckSquare, Plus } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Modal } from "@/components/Modal";
import { TransactionForm } from "@/components/forms/TransactionForm";
import { RecurringExpenseForm } from "@/components/forms/RecurringExpenseForm";
import { RecurringIncomeForm } from "@/components/forms/RecurringIncomeForm";
import { TransactionCard } from "@/components/items/TransactionCard";
import { Button } from "@/components/ui/Button";
import { getCashflowSummary } from "@/lib/cashflow";
import { currentMonth, formatCurrency, isWithinDays } from "@/lib/date";
import { scopeLabels, transactionTypeLabels } from "@/lib/labels";
import { controlAction, loadArchivedTransactions } from "@/lib/control-api";
import type { RecurringExpenseRule, RecurringIncomeRule, Scope, Transaction } from "@/lib/types";
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
  const [addingMonthlyType, setAddingMonthlyType] = useState<"income" | "expense" | null>(null);
  const [addingRecurringExpense, setAddingRecurringExpense] = useState(false);
  const [addingRecurringIncome, setAddingRecurringIncome] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editingRecurringExpense, setEditingRecurringExpense] = useState<RecurringExpenseRule | null>(null);
  const [editingRecurringIncome, setEditingRecurringIncome] = useState<RecurringIncomeRule | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [showArchived, setShowArchived] = useState(false);
  const [archivedTransactions, setArchivedTransactions] = useState<Transaction[] | null>(null);
  const [archivedPage, setArchivedPage] = useState(1);
  const [hasMoreArchived, setHasMoreArchived] = useState(false);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState("");
  const [archiveFeedback, setArchiveFeedback] = useState("");
  const [selectedRecurringRuleIds, setSelectedRecurringRuleIds] = useState<string[]>([]);
  const [recurringBusy, setRecurringBusy] = useState(false);
  const [recurringFeedback, setRecurringFeedback] = useState("");
  const [selectedRecurringIncomeRuleIds, setSelectedRecurringIncomeRuleIds] = useState<string[]>([]);
  const [recurringIncomeBusy, setRecurringIncomeBusy] = useState(false);
  const [recurringIncomeFeedback, setRecurringIncomeFeedback] = useState("");

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
        (item) => item.type === "expense" && item.status !== "paid" && item.status !== "cancelled" && isWithinDays(item.actual_date ?? item.expected_date, 7)
      ),
    [activeTransactions]
  );
  const monthKey = month.slice(0, 7);
  const recurringRulesForMonth = useMemo(
    () => data.recurringExpenseRules.filter((rule) =>
      rule.is_active && !rule.archived_at && rule.start_month <= month && (!rule.last_payment_month || rule.last_payment_month >= month)
    ),
    [data.recurringExpenseRules, month]
  );
  const recurringPaymentByRuleId = useMemo(() => new Map(
    activeTransactions
      .filter((item) => item.recurring_expense_rule_id && item.payment_month?.slice(0, 7) === monthKey)
      .map((item) => [item.recurring_expense_rule_id as string, item])
  ), [activeTransactions, monthKey]);
  const virtualRecurringExpenses = useMemo(() => recurringRulesForMonth
    .filter((rule) => !recurringPaymentByRuleId.has(rule.id))
    .map((rule) => recurringExpenseOccurrence(rule, month)), [recurringRulesForMonth, recurringPaymentByRuleId, month]);
  const recurringIncomeRulesForMonth = useMemo(
    () => data.recurringIncomeRules.filter((rule) =>
      rule.is_active && !rule.archived_at && rule.start_month <= month && (!rule.last_receipt_month || rule.last_receipt_month >= month)
    ),
    [data.recurringIncomeRules, month]
  );
  const recurringIncomeByRuleId = useMemo(() => new Map(
    activeTransactions
      .filter((item) => item.recurring_income_rule_id && item.payment_month?.slice(0, 7) === monthKey)
      .map((item) => [item.recurring_income_rule_id as string, item])
  ), [activeTransactions, monthKey]);
  const virtualRecurringIncome = useMemo(() => recurringIncomeRulesForMonth
    .filter((rule) => !recurringIncomeByRuleId.has(rule.id))
    .map((rule) => recurringIncomeOccurrence(rule, month)), [recurringIncomeRulesForMonth, recurringIncomeByRuleId, month]);
  const cashflowTransactions = useMemo(() => [...activeTransactions, ...virtualRecurringExpenses, ...virtualRecurringIncome], [activeTransactions, virtualRecurringExpenses, virtualRecurringIncome]);
  const thisMonthExpenses = useMemo(
    () => activeTransactions.filter((item) => item.type === "expense" && (item.actual_date ?? item.expected_date)?.slice(0, 7) === monthKey && !item.recurring_expense_rule_id),
    [activeTransactions, monthKey]
  );
  const thisMonthIncome = useMemo(
    () => activeTransactions.filter((item) => item.type === "income" && (item.actual_date ?? item.expected_date)?.slice(0, 7) === monthKey && !item.recurring_income_rule_id),
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
  const receivedThisMonth = useMemo(() => thisMonthIncome.filter((item) => item.status === "received"), [thisMonthIncome]);
  const expectedThisMonth = useMemo(() => thisMonthIncome.filter((item) => !["received", "cancelled"].includes(item.status)), [thisMonthIncome]);

  function toggleRecurringRule(ruleId: string) {
    setSelectedRecurringRuleIds((current) => current.includes(ruleId) ? current.filter((id) => id !== ruleId) : [...current, ruleId]);
  }

  function selectAllUnpaidRecurring() {
    setSelectedRecurringRuleIds(recurringRulesForMonth.filter((rule) => recurringPaymentByRuleId.get(rule.id)?.status !== "paid").map((rule) => rule.id));
  }

  async function markSelectedRecurringPaid() {
    if (!selectedRecurringRuleIds.length) return;
    setRecurringBusy(true);
    setRecurringFeedback("");
    try {
      const result = await controlAction<{ paidRuleIds: string[] }>("record_recurring_expense_payments", { ruleIds: selectedRecurringRuleIds, paymentMonth: monthKey });
      setRecurringFeedback(`已標記 ${result.paidRuleIds.length} 項 ${monthKey} 恆常支出為已付款。你仍可隨時改回未付款。`);
      setSelectedRecurringRuleIds([]);
      await reload();
    } catch (caught) {
      setRecurringFeedback(caught instanceof Error ? caught.message : "未能更新付款狀態，請稍後再試。");
    } finally {
      setRecurringBusy(false);
    }
  }

  function toggleRecurringIncomeRule(ruleId: string) {
    setSelectedRecurringIncomeRuleIds((current) => current.includes(ruleId) ? current.filter((id) => id !== ruleId) : [...current, ruleId]);
  }

  function selectAllUnreceivedRecurringIncome() {
    setSelectedRecurringIncomeRuleIds(recurringIncomeRulesForMonth.filter((rule) => recurringIncomeByRuleId.get(rule.id)?.status !== "received").map((rule) => rule.id));
  }

  async function markSelectedRecurringIncomeReceived() {
    if (!selectedRecurringIncomeRuleIds.length) return;
    setRecurringIncomeBusy(true);
    setRecurringIncomeFeedback("");
    try {
      const result = await controlAction<{ receivedRuleIds: string[] }>("record_recurring_income_receipts", { ruleIds: selectedRecurringIncomeRuleIds, receiptMonth: monthKey });
      setRecurringIncomeFeedback(`已標記 ${result.receivedRuleIds.length} 項 ${monthKey} 恆常收入為已收到。`);
      setSelectedRecurringIncomeRuleIds([]);
      await reload();
    } catch (caught) {
      setRecurringIncomeFeedback(caught instanceof Error ? caught.message : "未能更新收款狀態，請稍後再試。");
    } finally {
      setRecurringIncomeBusy(false);
    }
  }

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
          <Button onClick={() => setAddingMonthlyType("income")}>
            <Plus className="h-5 w-5" />
            新增臨時收入
          </Button>
          <Button variant="secondary" onClick={() => setAddingRecurringIncome(true)}>
            <Plus className="h-5 w-5" />
            新增恆常收入
          </Button>
          <Button variant="secondary" onClick={() => setAddingMonthlyType("expense")}>
            <Plus className="h-5 w-5" />
            新增臨時支出
          </Button>
          <Button variant="secondary" onClick={() => setAddingRecurringExpense(true)}>
            <Plus className="h-5 w-5" />
            新增恆常支出
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
        <CashflowScope scope="home" month={month} userId={userId} transactions={cashflowTransactions} balances={data.balances} reload={reload} />
        <CashflowScope scope="company" month={month} userId={userId} transactions={cashflowTransactions} balances={data.balances} reload={reload} />
      </section>

      <section className="panel p-4">
        <div>
          <h3 className="text-xl font-bold text-ink">恆常收入</h3>
          <p className="mt-1 text-sm text-slate-600">只按年月記錄。標記已收到後會在本月收入顯示；最後收款月份後不會再出現。</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={selectAllUnreceivedRecurringIncome}>全選未收到</Button>
          <Button disabled={recurringIncomeBusy || !selectedRecurringIncomeRuleIds.length} onClick={() => void markSelectedRecurringIncomeReceived()}>
            <CheckSquare className="h-5 w-5" />
            {recurringIncomeBusy ? "更新中…" : `批量標記已收到${selectedRecurringIncomeRuleIds.length ? `（${selectedRecurringIncomeRuleIds.length}）` : ""}`}
          </Button>
        </div>
        {recurringIncomeFeedback ? <p className="mt-3 rounded-lg bg-indigo-50 p-3 text-sm font-semibold text-indigo-900">{recurringIncomeFeedback}</p> : null}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <RecurringIncomeColumn title="個人／家庭恆常收入" scope="home" rules={recurringIncomeRulesForMonth} receipts={recurringIncomeByRuleId} selectedRuleIds={selectedRecurringIncomeRuleIds} onToggle={toggleRecurringIncomeRule} onChanged={handleActiveTransactionChanged} onEdit={setEditingRecurringIncome} />
          <RecurringIncomeColumn title="公司恆常收入" scope="company" rules={recurringIncomeRulesForMonth} receipts={recurringIncomeByRuleId} selectedRuleIds={selectedRecurringIncomeRuleIds} onToggle={toggleRecurringIncomeRule} onChanged={handleActiveTransactionChanged} onEdit={setEditingRecurringIncome} />
        </div>
      </section>

      <section className="panel p-4">
        <div>
          <h3 className="text-xl font-bold text-ink">恆常支出</h3>
          <p className="mt-1 text-sm text-slate-600">只按年月記錄。選擇最後付款月份後，下一個月便不會再顯示；已付款可隨時改回未付款。</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={selectAllUnpaidRecurring}>全選未付款</Button>
          <Button disabled={recurringBusy || !selectedRecurringRuleIds.length} onClick={() => void markSelectedRecurringPaid()}>
            <CheckSquare className="h-5 w-5" />
            {recurringBusy ? "更新中…" : `批量標記已付款${selectedRecurringRuleIds.length ? `（${selectedRecurringRuleIds.length}）` : ""}`}
          </Button>
        </div>
        {recurringFeedback ? <p className="mt-3 rounded-lg bg-indigo-50 p-3 text-sm font-semibold text-indigo-900">{recurringFeedback}</p> : null}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <RecurringExpenseColumn title="個人／家庭恆常支出" scope="home" rules={recurringRulesForMonth} payments={recurringPaymentByRuleId} selectedRuleIds={selectedRecurringRuleIds} onToggle={toggleRecurringRule} onChanged={handleActiveTransactionChanged} onEdit={setEditingRecurringExpense} />
          <RecurringExpenseColumn title="公司恆常支出" scope="company" rules={recurringRulesForMonth} payments={recurringPaymentByRuleId} selectedRuleIds={selectedRecurringRuleIds} onToggle={toggleRecurringRule} onChanged={handleActiveTransactionChanged} onEdit={setEditingRecurringExpense} />
        </div>
      </section>

      <section className="panel p-4">
        <div>
          <h3 className="text-xl font-bold text-ink">本月臨時收入</h3>
          <p className="mt-1 text-sm text-slate-600">只屬所選月份，不會自動帶到下個月。</p>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <MonthlyIncomeColumn title="個人／家庭臨時收入" scope="home" receivedItems={receivedThisMonth} expectedItems={expectedThisMonth} onChanged={handleActiveTransactionChanged} onEdit={setEditingTransaction} />
          <MonthlyIncomeColumn title="公司臨時收入" scope="company" receivedItems={receivedThisMonth} expectedItems={expectedThisMonth} onChanged={handleActiveTransactionChanged} onEdit={setEditingTransaction} />
        </div>
      </section>

      <section className="panel p-4">
        <div>
          <h3 className="text-xl font-bold text-ink">本月臨時支出</h3>
          <p className="mt-1 text-sm text-slate-600">只屬所選月份，不會自動帶到下個月；已付及未付分開列出。</p>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <MonthlyPaymentColumn title="個人／家庭臨時支出" scope="home" paidItems={paidThisMonth} unpaidItems={unpaidThisMonth} onChanged={handleActiveTransactionChanged} onEdit={setEditingTransaction} />
          <MonthlyPaymentColumn title="公司臨時支出" scope="company" paidItems={paidThisMonth} unpaidItems={unpaidThisMonth} onChanged={handleActiveTransactionChanged} onEdit={setEditingTransaction} />
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

      {addingMonthlyType ? (
        <Modal title={addingMonthlyType === "income" ? "新增臨時收入" : "新增臨時支出"} onClose={() => setAddingMonthlyType(null)}>
          <TransactionForm userId={userId} forcedType={addingMonthlyType} monthlyOnly onSaved={() => finish(reload, () => setAddingMonthlyType(null))} onCancel={() => setAddingMonthlyType(null)} />
        </Modal>
      ) : null}

      {addingRecurringIncome ? (
        <Modal title="新增恆常收入" onClose={() => setAddingRecurringIncome(false)}>
          <RecurringIncomeForm onSaved={() => finish(reload, () => setAddingRecurringIncome(false))} onCancel={() => setAddingRecurringIncome(false)} />
        </Modal>
      ) : null}

      {addingRecurringExpense ? (
        <Modal title="新增恆常支出" onClose={() => setAddingRecurringExpense(false)}>
          <RecurringExpenseForm onSaved={() => finish(reload, () => setAddingRecurringExpense(false))} onCancel={() => setAddingRecurringExpense(false)} />
        </Modal>
      ) : null}

      {editingRecurringExpense ? (
        <Modal title="修改恆常支出" onClose={() => setEditingRecurringExpense(null)}>
          <RecurringExpenseForm initialRule={editingRecurringExpense} onSaved={() => finish(reload, () => setEditingRecurringExpense(null))} onCancel={() => setEditingRecurringExpense(null)} />
        </Modal>
      ) : null}

      {editingRecurringIncome ? (
        <Modal title="修改恆常收入" onClose={() => setEditingRecurringIncome(null)}>
          <RecurringIncomeForm initialRule={editingRecurringIncome} onSaved={() => finish(reload, () => setEditingRecurringIncome(null))} onCancel={() => setEditingRecurringIncome(null)} />
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

function RecurringExpenseColumn({
  title,
  scope,
  rules,
  payments,
  selectedRuleIds,
  onToggle,
  onChanged,
  onEdit
}: {
  title: string;
  scope: Scope;
  rules: RecurringExpenseRule[];
  payments: Map<string, Transaction>;
  selectedRuleIds: string[];
  onToggle: (ruleId: string) => void;
  onChanged: () => void;
  onEdit: (rule: RecurringExpenseRule) => void;
}) {
  const scopedRules = rules
    .filter((rule) => rule.scope === scope)
    // Personal / family monthly expenses should start with the actionable items.
    // Keep paid items available, but place them after the unpaid list.
    .sort((left, right) => {
      if (scope !== "home") return 0;
      const leftPaid = payments.get(left.id)?.status === "paid";
      const rightPaid = payments.get(right.id)?.status === "paid";
      return Number(leftPaid) - Number(rightPaid);
    });

  async function setPaymentStatus(payment: Transaction, status: "paid" | "unpaid") {
    await controlAction("save_transaction", {
      ...payment,
      id: payment.id,
      status,
      actual_date: status === "paid" ? payment.payment_month : null
    });
    onChanged();
  }

  return (
    <section className={scope === "home" ? "rounded-xl bg-home-50 p-4" : "rounded-xl bg-work-50 p-4"}>
      <div className="flex items-center justify-between gap-3"><h4 className="text-lg font-bold text-ink">{title}</h4><span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700">{scopedRules.length} 項</span></div>
      <div className="mt-3 grid gap-3">
        {scopedRules.length ? scopedRules.map((rule) => {
          const payment = payments.get(rule.id);
          const paid = payment?.status === "paid";
          return (
            <article key={rule.id} className="rounded-xl bg-white p-4 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <label className="flex min-w-0 cursor-pointer items-start gap-3">
                  <input className="mt-1 h-5 w-5 accent-indigo-600" type="checkbox" checked={selectedRuleIds.includes(rule.id)} onChange={() => onToggle(rule.id)} aria-label={`選擇 ${rule.item}`} />
                  <span><span className="block text-lg font-bold text-ink">{rule.item}</span><span className="mt-1 block text-sm font-semibold text-slate-600">{formatCurrency(Number(rule.amount))}／月</span></span>
                </label>
                <span className={paid ? "rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800" : "rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900"}>{paid ? "已付款" : "未付款"}</span>
              </div>
              <p className="mt-3 text-sm text-slate-600">最後付款月份：{rule.last_payment_month ? rule.last_payment_month.slice(0, 7) : "持續，未設定"}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {payment ? <Button variant="secondary" onClick={() => void setPaymentStatus(payment, paid ? "unpaid" : "paid")}>{paid ? "改回未付款" : "標記已付款"}</Button> : null}
                <Button variant="ghost" onClick={() => onEdit(rule)}>修改設定</Button>
              </div>
            </article>
          );
        }) : <p className="rounded-lg bg-white p-4 text-sm font-semibold text-slate-600">這個月份沒有恆常支出。</p>}
      </div>
    </section>
  );
}

function recurringExpenseOccurrence(rule: RecurringExpenseRule, month: string): Transaction {
  return {
    id: `recurring-${rule.id}-${month}`,
    user_id: rule.user_id,
    scope: rule.scope,
    type: "expense",
    item: rule.item,
    category: rule.category,
    amount: Number(rule.amount),
    expected_date: month,
    actual_date: null,
    frequency: "monthly",
    status: "unpaid",
    payment_method: rule.payment_method,
    owner: rule.owner,
    proof_url: rule.proof_url,
    notes: rule.notes,
    recurring_expense_rule_id: rule.id,
    payment_month: month,
    archived_at: null,
    created_at: rule.created_at,
    updated_at: rule.updated_at
  };
}

function RecurringIncomeColumn({
  title,
  scope,
  rules,
  receipts,
  selectedRuleIds,
  onToggle,
  onChanged,
  onEdit
}: {
  title: string;
  scope: Scope;
  rules: RecurringIncomeRule[];
  receipts: Map<string, Transaction>;
  selectedRuleIds: string[];
  onToggle: (ruleId: string) => void;
  onChanged: () => void;
  onEdit: (rule: RecurringIncomeRule) => void;
}) {
  const scopedRules = rules.filter((rule) => rule.scope === scope);
  async function setReceiptStatus(receipt: Transaction, status: "received" | "expected") {
    await controlAction("save_transaction", { ...receipt, id: receipt.id, status, actual_date: status === "received" ? receipt.payment_month : null });
    onChanged();
  }

  return (
    <section className={scope === "home" ? "rounded-xl bg-home-50 p-4" : "rounded-xl bg-work-50 p-4"}>
      <div className="flex items-center justify-between gap-3"><h4 className="text-lg font-bold text-ink">{title}</h4><span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700">{scopedRules.length} 項</span></div>
      <div className="mt-3 grid gap-3">
        {scopedRules.length ? scopedRules.map((rule) => {
          const receipt = receipts.get(rule.id);
          const received = receipt?.status === "received";
          return <article key={rule.id} className="rounded-xl bg-white p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <label className="flex min-w-0 cursor-pointer items-start gap-3">
                <input className="mt-1 h-5 w-5 accent-indigo-600" type="checkbox" checked={selectedRuleIds.includes(rule.id)} onChange={() => onToggle(rule.id)} aria-label={`選擇 ${rule.item}`} />
                <span><span className="block text-lg font-bold text-ink">{rule.item}</span><span className="mt-1 block text-sm font-semibold text-slate-600">{formatCurrency(Number(rule.amount))}／月</span></span>
              </label>
              <span className={received ? "rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800" : "rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900"}>{received ? "已收到" : "未收到"}</span>
            </div>
            <p className="mt-3 text-sm text-slate-600">最後收款月份：{rule.last_receipt_month ? rule.last_receipt_month.slice(0, 7) : "持續，未設定"}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {receipt ? <Button variant="secondary" onClick={() => void setReceiptStatus(receipt, received ? "expected" : "received")}>{received ? "改回未收到" : "標記已收到"}</Button> : null}
              <Button variant="ghost" onClick={() => onEdit(rule)}>修改設定</Button>
            </div>
          </article>;
        }) : <p className="rounded-lg bg-white p-4 text-sm font-semibold text-slate-600">這個月份沒有恆常收入。</p>}
      </div>
    </section>
  );
}

function recurringIncomeOccurrence(rule: RecurringIncomeRule, month: string): Transaction {
  return {
    id: `recurring-income-${rule.id}-${month}`,
    user_id: rule.user_id,
    scope: rule.scope,
    type: "income",
    item: rule.item,
    category: rule.category,
    amount: Number(rule.amount),
    expected_date: month,
    actual_date: null,
    frequency: "monthly",
    status: "expected",
    payment_method: rule.payment_method,
    owner: rule.owner,
    proof_url: rule.proof_url,
    notes: rule.notes,
    recurring_income_rule_id: rule.id,
    payment_month: month,
    archived_at: null,
    created_at: rule.created_at,
    updated_at: rule.updated_at
  };
}

function MonthlyPaymentColumn({
  title,
  scope,
  paidItems,
  unpaidItems,
  onChanged,
  onEdit
}: {
  title: string;
  scope: Scope;
  paidItems: Transaction[];
  unpaidItems: Transaction[];
  onChanged: () => void;
  onEdit: (transaction: Transaction) => void;
}) {
  const scopePaid = paidItems.filter((item) => item.scope === scope);
  const scopeUnpaid = unpaidItems.filter((item) => item.scope === scope);
  return (
    <section className={scope === "home" ? "rounded-xl bg-home-50 p-4" : "rounded-xl bg-work-50 p-4"}>
      <h4 className="text-lg font-bold text-ink">{title}</h4>
      <div className="mt-3 grid gap-3">
        <PaymentGroup title="本月已付款" items={scopePaid} emptyMessage="本月暫時沒有已付款支出。" onChanged={onChanged} onEdit={onEdit} />
        <PaymentGroup title="本月未付款" items={scopeUnpaid} emptyMessage="本月暫時沒有未付款支出。" onChanged={onChanged} onEdit={onEdit} highlight />
      </div>
    </section>
  );
}

function MonthlyIncomeColumn({
  title,
  scope,
  receivedItems,
  expectedItems,
  onChanged,
  onEdit
}: {
  title: string;
  scope: Scope;
  receivedItems: Transaction[];
  expectedItems: Transaction[];
  onChanged: () => void;
  onEdit: (transaction: Transaction) => void;
}) {
  return (
    <section className={scope === "home" ? "rounded-xl bg-home-50 p-4" : "rounded-xl bg-work-50 p-4"}>
      <h4 className="text-lg font-bold text-ink">{title}</h4>
      <div className="mt-3 grid gap-3">
        <PaymentGroup title="本月已收到" items={receivedItems.filter((item) => item.scope === scope)} emptyMessage="本月暫時沒有已收到收入。" onChanged={onChanged} onEdit={onEdit} />
        <PaymentGroup title="本月未收到" items={expectedItems.filter((item) => item.scope === scope)} emptyMessage="本月暫時沒有未收到收入。" onChanged={onChanged} onEdit={onEdit} highlight />
      </div>
    </section>
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
