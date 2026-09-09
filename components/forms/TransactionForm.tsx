"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { expenseStatusOptions, frequencyOptions, incomeStatusOptions, scopeOptions, transactionTypeLabels } from "@/lib/labels";
import { controlAction } from "@/lib/control-api";
import type { Transaction } from "@/lib/types";

type TransactionFormState = {
  scope: string;
  type: "income" | "expense";
  item: string;
  category: string;
  amount: string;
  actual_date: string;
  frequency: string;
  status: string;
  payment_method: string;
  owner: string;
  proof_url: string;
  notes: string;
};

const defaultState: TransactionFormState = {
  scope: "home",
  type: "expense",
  item: "",
  category: "",
  amount: "",
  actual_date: "",
  frequency: "one_time",
  status: "unpaid",
  payment_method: "",
  owner: "",
  proof_url: "",
  notes: ""
};

export function TransactionForm({
  initialTransaction,
  forcedType,
  monthlyOnly = false,
  compact = false,
  onSaved,
  onCancel
}: {
  userId: string;
  initialTransaction?: Transaction | null;
  forcedType?: "income" | "expense";
  monthlyOnly?: boolean;
  compact?: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<TransactionFormState>(() => {
    const type = forcedType ?? initialTransaction?.type ?? "expense";
    return initialTransaction
      ? {
          scope: initialTransaction.scope,
          type,
          item: initialTransaction.item,
          category: initialTransaction.category ?? "",
          amount: String(initialTransaction.amount ?? ""),
          // Older records used expected_date.  Show that value as the single
          // payment date so users never have to manage two dates.
          actual_date: initialTransaction.actual_date ?? initialTransaction.expected_date ?? "",
          frequency: initialTransaction.frequency,
          status: initialTransaction.status,
          payment_method: initialTransaction.payment_method ?? "",
          owner: initialTransaction.owner ?? "",
          proof_url: initialTransaction.proof_url ?? "",
          notes: initialTransaction.notes ?? ""
        }
      : { ...defaultState, type, frequency: monthlyOnly ? "monthly" : "one_time", status: type === "income" ? "expected" : "unpaid" };
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function update(name: keyof TransactionFormState, value: string) {
    setForm((current) => {
      if (name === "type") return { ...current, type: value as "income" | "expense", status: value === "income" ? "expected" : "unpaid" };
      return { ...current, [name]: value };
    });
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("金額必須大於 0。");
      return;
    }

    setSaving(true);
    const payload = {
      id: initialTransaction?.id,
      scope: form.scope,
      type: form.type,
      item: form.item.trim(),
      category: form.category.trim() || null,
      amount,
      // expected_date remains populated for backwards-compatible reporting,
      // but the interface and source of truth are the one actual payment date.
      expected_date: form.actual_date || null,
      actual_date: form.actual_date || null,
      frequency: monthlyOnly ? "monthly" : form.frequency,
      status: form.status,
      payment_method: form.payment_method.trim() || null,
      owner: form.owner.trim() || null,
      proof_url: form.proof_url.trim() || null,
      notes: form.notes.trim() || null
    };

    try {
      await controlAction("save_transaction", payload);
    } catch (caught) {
      setSaving(false);
      setError(caught instanceof Error ? caught.message : "儲存收入支出失敗，請稍後再試。");
      return;
    }
    setSaving(false);
    if (!initialTransaction) setForm({ ...defaultState, type: forcedType ?? "expense", frequency: monthlyOnly ? "monthly" : "one_time", status: forcedType === "income" ? "expected" : "unpaid" });
    onSaved();
  }

  const statusOptions = form.type === "income" ? incomeStatusOptions : expenseStatusOptions;

  return (
    <form className="grid gap-4" onSubmit={save}>
      <div className="grid gap-4 sm:grid-cols-3">
        <label>
          <span className="label">家庭 / 公司</span>
          <select className="field mt-2" value={form.scope} onChange={(event) => update("scope", event.target.value)}>
            {scopeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">收入 / 支出</span>
          <select
            className="field mt-2"
            value={form.type}
            onChange={(event) => update("type", event.target.value)}
            disabled={Boolean(forcedType)}
          >
            <option value="income">{transactionTypeLabels.income}</option>
            <option value="expense">{transactionTypeLabels.expense}</option>
          </select>
        </label>
        <label>
          <span className="label">狀態</span>
          <select className="field mt-2" value={form.status} onChange={(event) => update("status", event.target.value)}>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="label">項目</span>
          <input className="field mt-2" value={form.item} onChange={(event) => update("item", event.target.value)} required />
        </label>
        <label>
          <span className="label">金額</span>
          <input className="field mt-2" type="number" min="0" step="0.01" value={form.amount} onChange={(event) => update("amount", event.target.value)} required />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="label">實際日期</span>
          <input className="field mt-2" type={monthlyOnly || form.frequency === "monthly" ? "month" : "date"} value={monthlyOnly || form.frequency === "monthly" ? form.actual_date.slice(0, 7) : form.actual_date} onChange={(event) => update("actual_date", (monthlyOnly || form.frequency === "monthly") && event.target.value ? `${event.target.value}-01` : event.target.value)} />
        </label>
        {!monthlyOnly ? <label>
          <span className="label">頻率</span>
          <select className="field mt-2" value={form.frequency} onChange={(event) => update("frequency", event.target.value)}>
            {frequencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label> : null}
      </div>
      {!compact ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <label>
              <span className="label">分類</span>
              <input className="field mt-2" value={form.category} onChange={(event) => update("category", event.target.value)} />
            </label>
            <label>
              <span className="label">付款方式</span>
              <input className="field mt-2" value={form.payment_method} onChange={(event) => update("payment_method", event.target.value)} />
            </label>
            <label>
              <span className="label">負責人</span>
              <input className="field mt-2" value={form.owner} onChange={(event) => update("owner", event.target.value)} />
            </label>
          </div>
          <label>
            <span className="label">證明連結</span>
            <input className="field mt-2" value={form.proof_url} onChange={(event) => update("proof_url", event.target.value)} />
          </label>
          <label>
            <span className="label">備註</span>
            <textarea className="field mt-2 min-h-28" value={form.notes} onChange={(event) => update("notes", event.target.value)} />
          </label>
        </>
      ) : null}
      {error ? <p className="rounded-lg bg-red-50 p-3 text-base font-semibold text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "儲存中..." : initialTransaction ? "儲存修改" : form.type === "income" ? "新增收入" : "新增支出"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            取消
          </Button>
        ) : null}
      </div>
    </form>
  );
}
