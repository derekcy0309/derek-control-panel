"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { scopeOptions } from "@/lib/labels";
import { currentMonth } from "@/lib/date";
import type { RecurringIncomeRule } from "@/lib/types";

type FormState = {
  scope: string;
  item: string;
  amount: string;
  start_month: string;
  last_receipt_month: string;
  category: string;
  payment_method: string;
  owner: string;
  notes: string;
};

export function RecurringIncomeForm({ initialRule, onSaved, onCancel }: {
  initialRule?: RecurringIncomeRule | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialRule ? {
    scope: initialRule.scope, item: initialRule.item, amount: String(initialRule.amount),
    start_month: initialRule.start_month.slice(0, 7), last_receipt_month: initialRule.last_receipt_month?.slice(0, 7) ?? "",
    category: initialRule.category ?? "", payment_method: initialRule.payment_method ?? "", owner: initialRule.owner ?? "", notes: initialRule.notes ?? ""
  } : {
    scope: "home", item: "", amount: "", start_month: currentMonth().slice(0, 7), last_receipt_month: "",
    category: "", payment_method: "", owner: "", notes: ""
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (name: keyof FormState, value: string) => setForm((current) => ({ ...current, [name]: value }));

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const amount = Number(form.amount);
    if (!form.item.trim()) return setError("請輸入恆常收入名稱。");
    if (!Number.isFinite(amount) || amount <= 0) return setError("金額必須大於 0。");
    if (!form.start_month) return setError("請選擇開始收款月份。");
    if (form.last_receipt_month && form.last_receipt_month < form.start_month) return setError("最後收款月份不可早於開始月份。");
    setSaving(true);
    try {
      await controlAction("save_recurring_income_rule", {
        id: initialRule?.id, scope: form.scope, item: form.item.trim(), amount, start_month: form.start_month,
        last_receipt_month: form.last_receipt_month || null, category: form.category.trim() || null,
        payment_method: form.payment_method.trim() || null, owner: form.owner.trim() || null, notes: form.notes.trim() || null
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能儲存恆常收入，請稍後再試。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={save}>
      <p className="rounded-lg bg-indigo-50 p-3 text-sm font-semibold leading-6 text-indigo-900">收款及最後一期只記錄年月；最後收款月份後，下一個月不會再顯示。</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className="label">個人／公司</span><select className="field mt-2" value={form.scope} onChange={(event) => update("scope", event.target.value)}>{scopeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span className="label">恆常收入</span><input className="field mt-2" value={form.item} onChange={(event) => update("item", event.target.value)} required /></label>
        <label><span className="label">每月金額</span><input className="field mt-2" type="number" min="0" step="0.01" value={form.amount} onChange={(event) => update("amount", event.target.value)} required /></label>
        <label><span className="label">開始收款月份</span><input className="field mt-2" type="month" value={form.start_month} onChange={(event) => update("start_month", event.target.value)} required /></label>
        <label><span className="label">最後收款月份（可留空）</span><input className="field mt-2" type="month" value={form.last_receipt_month} onChange={(event) => update("last_receipt_month", event.target.value)} /></label>
        <label><span className="label">分類</span><input className="field mt-2" value={form.category} onChange={(event) => update("category", event.target.value)} /></label>
        <label><span className="label">收款方式</span><input className="field mt-2" value={form.payment_method} onChange={(event) => update("payment_method", event.target.value)} /></label>
        <label><span className="label">負責人</span><input className="field mt-2" value={form.owner} onChange={(event) => update("owner", event.target.value)} /></label>
      </div>
      <label><span className="label">備註</span><textarea className="field mt-2 min-h-24" value={form.notes} onChange={(event) => update("notes", event.target.value)} /></label>
      {error ? <p className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">{error}</p> : null}
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={saving}>{saving ? "儲存中…" : initialRule ? "儲存修改" : "新增恆常收入"}</Button><Button type="button" variant="secondary" onClick={onCancel}>取消</Button></div>
    </form>
  );
}
