"use client";

import { Copy, FilePenLine, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ScopeBadge, StatusBadge } from "@/components/ui/Badge";
import { formatCurrency, formatDate, nextMonthDate } from "@/lib/date";
import { frequencyLabels, transactionTypeLabels } from "@/lib/labels";
import { controlAction } from "@/lib/control-api";
import type { Transaction } from "@/lib/types";

export function TransactionCard({
  transaction,
  onChanged,
  onEdit,
  onRestore,
  archived = false,
  highlight = false
}: {
  transaction: Transaction;
  onChanged: () => void;
  onEdit?: (transaction: Transaction) => void;
  onRestore?: (transaction: Transaction) => Promise<void>;
  archived?: boolean;
  highlight?: boolean;
}) {
  async function updateTransaction(values: Partial<Transaction>) {
    await controlAction("save_transaction", { ...transaction, ...values, id: transaction.id });
    onChanged();
  }

  async function copyToNextMonth() {
    const payload = {
      user_id: transaction.user_id,
      scope: transaction.scope,
      type: transaction.type,
      item: transaction.item,
      category: transaction.category,
      amount: transaction.amount,
      expected_date: nextMonthDate(transaction.actual_date ?? transaction.expected_date),
      actual_date: nextMonthDate(transaction.actual_date ?? transaction.expected_date),
      frequency: transaction.frequency,
      status: transaction.type === "income" ? "expected" : "unpaid",
      payment_method: transaction.payment_method,
      owner: transaction.owner,
      proof_url: transaction.proof_url,
      notes: transaction.notes
    };
    await controlAction("save_transaction", payload);
    onChanged();
  }

  const isIncome = transaction.type === "income";

  return (
    <article className={highlight ? "rounded-xl border-2 border-orange-200 bg-orange-50 p-4 shadow-soft" : "panel-soft p-4"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-2">
            <ScopeBadge scope={transaction.scope} />
            <StatusBadge status={transaction.status} />
          </div>
          <h3 className="mt-3 text-xl font-bold text-ink">{transaction.item}</h3>
          <p className="mt-1 text-base font-semibold text-slate-600">
            {transactionTypeLabels[transaction.type]} · {frequencyLabels[transaction.frequency]}
          </p>
        </div>
        {onEdit ? (
          <Button variant="secondary" onClick={() => onEdit(transaction)} title="修改">
            <FilePenLine className="h-5 w-5" />
            修改
          </Button>
        ) : null}
      </div>
      <div className="mt-4 grid gap-2 text-base text-slate-700 sm:grid-cols-2">
        <p className="text-xl font-bold">{formatCurrency(Number(transaction.amount))}</p>
        <p>實際日期：{formatDate(transaction.actual_date ?? transaction.expected_date)}</p>
        <p>分類：{transaction.category || "未設定"}</p>
      </div>
      {archived ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-600">這項記錄已封存，不會計入目前的收入、支出或付款提醒。</p>
          {onRestore ? (
            <Button variant="secondary" onClick={() => void onRestore(transaction)}>
              <RotateCcw className="h-5 w-5" />
              還原到現金流
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {isIncome ? (
          <>
            <Button variant="success" onClick={() => updateTransaction({ status: "received", actual_date: new Date().toISOString().slice(0, 10) })}>
              已收到
            </Button>
            <Button variant="secondary" onClick={() => updateTransaction({ status: "delayed" })}>
              延遲
            </Button>
            <Button variant="danger" onClick={() => updateTransaction({ status: "problem" })}>
              有問題
            </Button>
            <Button variant="ghost" onClick={() => updateTransaction({ status: "cancelled" })}>
              取消
            </Button>
          </>
          ) : (
          <>
            {transaction.status === "paid" ? (
              <Button variant="secondary" onClick={() => updateTransaction({ status: "unpaid", actual_date: null })}>
                改回未付款
              </Button>
            ) : (
              <Button variant="success" onClick={() => updateTransaction({ status: "paid", actual_date: new Date().toISOString().slice(0, 10) })}>
                已付款
              </Button>
            )}
            <Button variant="danger" onClick={() => updateTransaction({ status: "problem" })}>
              有問題
            </Button>
            <Button variant="secondary" onClick={() => updateTransaction({ status: "skipped" })}>
              跳過
            </Button>
            <Button variant="ghost" onClick={() => updateTransaction({ status: "cancelled" })}>
              取消
            </Button>
          </>
          )}
          <Button variant="secondary" onClick={copyToNextMonth}>
            <Copy className="h-5 w-5" />
            複製到下月
          </Button>
          <Button variant="ghost" onClick={() => updateTransaction({ archived_at: new Date().toISOString() })}>
            封存
          </Button>
        </div>
      )}
    </article>
  );
}
