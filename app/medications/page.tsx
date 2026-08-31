"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { FileDown, Pencil, Pill, Plus, Trash2 } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { Button } from "@/components/ui/Button";
import { alternatingDateTone, doseWithUnit, localToday, medicationPresets, type MedicationPreset } from "@/lib/medication-records";

type MedicationRecord = { id: string; entry_date: string; medication: string; dosage: string; effect: string | null; created_at: string; updated_at: string };
type MedicationDraft = { medication: MedicationPreset; otherMedication: string; dosage: string; effect: string };
type FormState = { id?: string; entryDate: string; entries: MedicationDraft[] };

const blankEntry = (): MedicationDraft => ({ medication: "Ritalin", otherMedication: "", dosage: "", effect: "" });
const blankForm = (): FormState => ({ entryDate: localToday(), entries: [blankEntry()] });

export default function MedicationsPage() {
  return <AuthGate><MedicationRecords /></AuthGate>;
}

function MedicationRecords() {
  const [records, setRecords] = useState<MedicationRecord[]>([]);
  const [form, setForm] = useState<FormState>(blankForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/medication-logs", { credentials: "same-origin", cache: "no-store" });
      const result = await response.json().catch(() => ({})) as { records?: MedicationRecord[]; error?: string };
      if (!response.ok) throw new Error(result.error || "未能讀取藥物紀錄。");
      setRecords(result.records ?? []);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能讀取藥物紀錄。");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const groups = useMemo(() => {
    const grouped = new Map<string, MedicationRecord[]>();
    records.forEach((record) => grouped.set(record.entry_date, [...(grouped.get(record.entry_date) ?? []), record]));
    return [...grouped.entries()];
  }, [records]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage(""); setSaving(true);
    try {
      const response = await fetch("/api/medication-logs", {
        method: form.id ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form.id
          ? { id: form.id, entryDate: form.entryDate, ...form.entries[0] }
          : { entryDate: form.entryDate, records: form.entries })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "未能儲存藥物紀錄。");
      setForm(blankForm());
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能儲存藥物紀錄。");
    } finally { setSaving(false); }
  }

  function edit(record: MedicationRecord) {
    const known = medicationPresets.slice(0, -1).includes(record.medication as MedicationPreset);
    setForm({ id: record.id, entryDate: record.entry_date, entries: [{ medication: known ? record.medication as MedicationPreset : "其他藥物", otherMedication: known ? "" : record.medication, dosage: record.dosage, effect: record.effect ?? "" }] });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateEntry(index: number, patch: Partial<MedicationDraft>) {
    setForm({ ...form, entries: form.entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry) });
  }

  async function remove(record: MedicationRecord) {
    if (!window.confirm(`刪除 ${record.entry_date} 的 ${record.medication} 紀錄？`)) return;
    setMessage("");
    const response = await fetch(`/api/medication-logs?id=${encodeURIComponent(record.id)}`, { method: "DELETE", credentials: "same-origin" });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setMessage(result.error || "未能刪除藥物紀錄。"); return; }
    await load();
  }

  return <div className="space-y-5 medication-print-root">
    <style jsx global>{`@media print { .sidebar,.topbar,.mobile-nav,.no-print { display:none !important; } .medication-print-root { max-width:none !important; } .print-record-group { break-inside:avoid; box-shadow:none !important; } }`}</style>
    <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between no-print"><div><p className="eyebrow">Personal</p><h1 className="page-title mt-1">個人藥物紀錄</h1><p className="muted mt-2 text-sm leading-6">只限你本人查看。藥物名稱、劑量和效果會留在這裡，不會加入通知或交接。</p></div><Button variant="secondary" onClick={() => window.print()}><FileDown className="h-5 w-5" />列印／儲存 PDF</Button></section>

    <form className="panel p-4 sm:p-5 no-print" onSubmit={save}>
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold">{form.id ? "修改紀錄" : "新增藥物紀錄"}</h2><p className="muted mt-1 text-sm">日期預設今日，你可直接更改；同一日可一次記錄多隻藥。</p></div>{form.id ? <Button type="button" variant="ghost" onClick={() => setForm(blankForm())}>取消修改</Button> : null}</div>
      <label className="mt-4 block max-w-sm"><span className="label">日期</span><input className="field mt-2" type="date" value={form.entryDate} onChange={(event) => setForm({ ...form, entryDate: event.target.value })} required /></label>
      <div className="mt-4 space-y-4">
        {form.entries.map((entry, index) => <fieldset key={index} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"><div className="flex items-center justify-between gap-3"><legend className="text-sm font-extrabold text-slate-800">藥物 {index + 1}</legend>{!form.id && form.entries.length > 1 ? <button type="button" className="text-sm font-bold text-slate-600 underline" onClick={() => setForm({ ...form, entries: form.entries.filter((_, entryIndex) => entryIndex !== index) })}>移除此藥</button> : null}</div><div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label><span className="label">藥物</span><select className="field mt-2" value={entry.medication} onChange={(event) => updateEntry(index, { medication: event.target.value as MedicationPreset })}>{medicationPresets.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          {entry.medication === "其他藥物" ? <label><span className="label">其他藥物名稱</span><input className="field mt-2" value={entry.otherMedication} onChange={(event) => updateEntry(index, { otherMedication: event.target.value })} placeholder="自行輸入藥物名稱" required /></label> : null}
          <label><span className="label">劑量</span><div className="relative mt-2"><input className="field pr-12" value={entry.dosage} onChange={(event) => updateEntry(index, { dosage: event.target.value })} placeholder="例如 10" required /><span className="pointer-events-none absolute inset-y-0 right-4 grid place-items-center text-sm font-bold text-slate-500">mg</span></div></label>
        </div><label className="mt-4 block"><span className="label">效果</span><textarea className="field mt-2 min-h-20" value={entry.effect} onChange={(event) => updateEntry(index, { effect: event.target.value })} placeholder="自由填寫；可留空。" /></label></fieldset>)}
      </div>
      {!form.id ? <Button className="mt-4" type="button" variant="secondary" onClick={() => setForm({ ...form, entries: [...form.entries, blankEntry()] })}><Plus className="h-5 w-5" />加另一隻藥</Button> : null}
      {message ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">{message}</p> : null}
      <Button className="mt-4" type="submit" disabled={saving}>{saving ? "儲存中…" : <><Plus className="h-5 w-5" />{form.id ? "儲存修改" : `儲存 ${form.entries.length} 項紀錄`}</>}</Button>
    </form>

    <section className="space-y-3"><div className="print-only hidden print:block"><h2 className="text-xl font-bold">個人藥物紀錄</h2><p className="mt-1 text-sm text-slate-600">列印日期：{localToday()}</p></div>{loading ? <div className="panel p-6 text-sm text-slate-600">正在讀取藥物紀錄…</div> : groups.length ? groups.map(([date, entries], index) => <section key={date} className={`print-record-group rounded-2xl p-4 ring-1 sm:p-5 ${alternatingDateTone(index)}`}><h2 className="font-extrabold text-slate-900">{date}</h2><div className="mt-3 grid gap-3 lg:grid-cols-2">{entries.map((record) => <article key={record.id} className="rounded-xl bg-white/85 p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-950">{record.medication}</p><p className="mt-1 text-sm font-semibold text-indigo-700">{doseWithUnit(record.dosage)}</p></div><div className="flex gap-1 no-print"><button type="button" className="icon-button" aria-label="修改紀錄" onClick={() => edit(record)}><Pencil className="h-4 w-4" /></button><button type="button" className="icon-button text-rose-700" aria-label="刪除紀錄" onClick={() => void remove(record)}><Trash2 className="h-4 w-4" /></button></div></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{record.effect || "未有填寫效果。"}</p></article>)}</div></section>) : <div className="panel p-8 text-center"><Pill className="mx-auto h-7 w-7 text-indigo-500" /><h2 className="mt-3 text-lg font-bold">尚未有藥物紀錄</h2><p className="muted mt-2 text-sm">先記下今日服用的藥物、劑量和效果。</p></div>}</section>
  </div>;
}
