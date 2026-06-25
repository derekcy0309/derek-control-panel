"use client";

import { Copy, FilePenLine } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ScopeBadge, StatusBadge } from "@/components/ui/Badge";
import { formatCurrency, formatDate, nextMonthDate } from "@/lib/date";
import { frequencyLabels, transactionTypeLabels } from "@/lib/labels";
import { supabase } from "@/lib/supabase";
import type { Transaction } from "@/lib/types";

export function TransactionCard({
  transaction,
  onChanged,
  onEdit,
  highlight = false
}: {
  transaction: Transaction;
  onChanged: () => void;
  onEdit?: (transaction: Transaction) => void;
  highlight?: boolean;
}) {
  async function updateTransaction(values: Partial<Transaction>) {
    await supabase?.from("transactions").update(values).eq("id", transaction.id);
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
      expected_date: nextMonthDate(transaction.expected_date),
      actual_date: null,
      frequency: transaction.frequency,
      status: transaction.type === "income" ? "expected" : "unpaid",
      payment_method: transaction.payment_method,
      owner: transaction.owner,
      proof_url: transaction.proof_url,
      notes: transaction.notes
    };
    await supabase?.from("transactions").insert(payload);
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
        <p>預計日期：{formatDate(transaction.expected_date)}</p>
        <p>實際日期：{formatDate(transaction.actual_date)}</p>
        <p>分類：{transaction.category || "未設定"}</p>
      </div>
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
            <Button variant="success" onClick={() => updateTransaction({ status: "paid", actual_date: new Date().toISOString().slice(0, 10) })}>
              已付款
            </Button>
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
    </article>
  );
}
