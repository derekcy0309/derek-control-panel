"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, PauseCircle, UsersRound } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Button } from "@/components/ui/Button";
import { loadWeeklyReview, saveWeeklyReview } from "@/lib/control-api";
import { assessWeeklyCapacity } from "@/lib/weekly-review";
import type { WeeklyReviewItem, WeeklyReviewSummary } from "@/lib/types";

const steps = [
  "本週完成",
  "仍在處理",
  "受阻工作",
  "Waiting 跟進",
  "下週三件事",
  "可用時間",
  "重新分工",
  "第一小步"
];

type ReviewForm = {
  outcomes: string[];
  availableMinutes: string;
  rebalancingNote: string;
  nextMinimumAction: string;
  reflection: string;
};

export default function WeeklyReviewPage() {
  return <AuthGate><WeeklyReviewContent /></AuthGate>;
}

function WeeklyReviewContent() {
  const [summary, setSummary] = useState<WeeklyReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<ReviewForm>(emptyForm());

  async function reload(weekStart?: string) {
    setLoading(true);
    setError("");
    try {
      const next = await loadWeeklyReview(weekStart);
      setSummary(next);
      setStep(0);
      setMessage("");
      setForm(formFromReview(next));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能讀取週檢視。" );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  const capacity = useMemo(() => {
    if (!summary) return assessWeeklyCapacity(0, null);
    const minutes = form.availableMinutes.trim() === "" ? null : Number(form.availableMinutes);
    return assessWeeklyCapacity(summary.known_estimated_minutes, Number.isFinite(minutes) ? minutes : null);
  }, [form.availableMinutes, summary]);

  async function save(complete = false) {
    if (!summary || summary.review?.status === "completed") return;
    setSaving(true);
    setMessage("");
    try {
      const result = await saveWeeklyReview({
        weekStart: summary.week_start,
        nextWeekOutcomes: form.outcomes,
        nextWeekAvailableMinutes: form.availableMinutes.trim() === "" ? null : Number(form.availableMinutes),
        rebalancingNote: form.rebalancingNote,
        nextMinimumAction: form.nextMinimumAction,
        reflection: form.reflection,
        complete
      });
      setSummary((current) => current ? { ...current, review: result.review } : current);
      setMessage(complete ? "已完成這次檢視。今日不需要再完成其他事情。" : "草稿已儲存；你可隨時回來繼續。" );
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能儲存，資料仍留在目前畫面。" );
    } finally {
      setSaving(false);
    }
  }

  if (loading || error || !summary) return <LoadingState error={error} />;
  const locked = summary.review?.status === "completed";
  const selectedHistory = summary.history.filter((review) => review.week_start !== summary.week_start);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <section className="panel flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">低壓力 Weekly Review</p>
          <h1 className="mt-1 text-2xl font-bold">慢慢整理一週，不用交成績表</h1>
          <p className="muted mt-2 max-w-2xl">只看有幫助的訊號，先為下星期留一個可重新開始的入口。這個流程不會自動完成、延期、交派或移動任何任務。</p>
        </div>
        <div className="rounded-xl bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800">{formatWeek(summary.week_start, summary.week_end)}</div>
      </section>

      {locked ? <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><div className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-5 w-5" />這次檢視已完成</div><p className="mt-1">已保留你的下星期成果和第一步；不會自動改動任何工作。</p></section> : null}

      {selectedHistory.length ? <section className="panel p-4"><p className="label">最近檢視</p><div className="mt-2 flex flex-wrap gap-2">{selectedHistory.map((review) => <button key={review.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => void reload(review.week_start)}>{review.week_start}{review.status === "completed" ? " · 已完成" : " · 草稿"}</button>)}</div></section> : null}

      <section className="panel p-4">
        <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-600">第 {step + 1}／{steps.length} 步</p><p className="text-sm font-bold text-indigo-700">{steps[step]}</p></div>
        <div className="mt-3 flex gap-1" aria-label="週檢視進度">{steps.map((label, index) => <div key={label} className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-indigo-500" : "bg-slate-200"}`} />)}</div>
      </section>

      <section className="panel min-h-[22rem] p-5 sm:p-6">
        {step === 0 ? <ReviewListStep icon={<CheckCircle2 className="h-6 w-6 text-emerald-600" />} title="本週完成了甚麼" intro="這些是已完成的任務。看見它們就足夠，不需要比較數字。" items={summary.completed} count={summary.counts.completed} empty="這星期未有完成紀錄也可以；我們直接看看下一個可行步驟。" /> : null}
        {step === 1 ? <ReviewListStep icon={<ClipboardCheck className="h-6 w-6 text-indigo-600" />} title="仍在處理甚麼" intro="只顯示最接近截止日的項目，避免一次打開整個 backlog。" items={summary.active} count={summary.counts.active} empty="目前沒有進行中的私人任務。" /> : null}
        {step === 2 ? <ReviewListStep icon={<PauseCircle className="h-6 w-6 text-amber-600" />} title="有甚麼被阻塞" intro="阻塞不是失敗，只是一個需要資料、時間或支援的訊號。" items={summary.blocked} count={summary.counts.blocked} empty="沒有被標示為受阻的任務。" /> : null}
        {step === 3 ? <ReviewListStep icon={<ArrowRight className="h-6 w-6 text-sky-600" />} title="Waiting 有甚麼需要跟進" intro="只列出沒有 follow-up 日期，或跟進日期已到的 Waiting 任務。" items={summary.waiting} count={summary.counts.waiting} empty="沒有需要立即跟進的 Waiting 任務。" /> : null}
        {step === 4 ? <OutcomesStep form={form} disabled={locked} onChange={(outcomes) => setForm((current) => ({ ...current, outcomes }))} /> : null}
        {step === 5 ? <CapacityStep summary={summary} value={form.availableMinutes} assessment={capacity} disabled={locked} onChange={(availableMinutes) => setForm((current) => ({ ...current, availableMinutes }))} /> : null}
        {step === 6 ? <RebalancingStep value={form.rebalancingNote} disabled={locked} onChange={(rebalancingNote) => setForm((current) => ({ ...current, rebalancingNote }))} /> : null}
        {step === 7 ? <FinishStep form={form} disabled={locked} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} /> : null}
      </section>

      {message ? <p className="rounded-2xl bg-slate-100 p-4 text-sm font-semibold text-slate-700" role="status">{message}</p> : null}

      <section className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <Button variant="secondary" disabled={step === 0 || saving} onClick={() => setStep((current) => Math.max(0, current - 1))}><ArrowLeft className="h-4 w-4" />上一步</Button>
        <div className="flex flex-wrap gap-2">
          {!locked ? <Button variant="secondary" disabled={saving} onClick={() => void save(false)}>{saving ? "儲存中…" : "先儲存草稿"}</Button> : null}
          {step < steps.length - 1 ? <Button disabled={saving} onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}>下一步<ArrowRight className="h-4 w-4" /></Button> : locked ? <Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-base font-semibold text-white transition hover:bg-indigo-700" href="/">回到今日</Link> : <Button disabled={saving || !form.nextMinimumAction.trim()} onClick={() => void save(true)}><CheckCircle2 className="h-4 w-4" />確認完成週檢視</Button>}
        </div>
      </section>
    </div>
  );
}

function ReviewListStep({ icon, title, intro, items, count, empty }: { icon: ReactNode; title: string; intro: string; items: WeeklyReviewItem[]; count: number; empty: string }) {
  return <div><div className="flex items-start gap-3">{icon}<div><h2 className="text-xl font-bold">{title}</h2><p className="muted mt-1">{intro}</p></div></div>{items.length ? <div className="mt-5 space-y-2">{items.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-3"><p className="font-semibold text-slate-800">{item.title}</p>{item.next_action ? <p className="muted mt-1 text-sm">下一步：{item.next_action}</p> : null}{item.due_date || item.follow_up_date ? <p className="mt-2 text-xs font-semibold text-slate-500">{item.due_date ? `截止：${item.due_date}` : `跟進：${item.follow_up_date}`}</p> : null}</article>)}</div> : <p className="mt-6 rounded-xl bg-slate-50 p-4 text-slate-600">{empty}</p>}{count > items.length ? <p className="muted mt-4 text-sm">另有 {count - items.length} 項未在此展開，避免把整個 backlog 一次放到眼前。</p> : null}</div>;
}

function OutcomesStep({ form, disabled, onChange }: { form: ReviewForm; disabled: boolean; onChange: (outcomes: string[]) => void }) {
  return <div><h2 className="text-xl font-bold">下星期重要的三個結果</h2><p className="muted mt-2">這是你想保留的方向，不是承諾清單。留空也可以先存草稿。</p><div className="mt-5 space-y-3">{form.outcomes.map((outcome, index) => <label key={index}><span className="label">結果 {index + 1}</span><input className="field mt-2" disabled={disabled} maxLength={500} value={outcome} placeholder="例如：確認學校文件是否齊備" onChange={(event) => { const next = [...form.outcomes]; next[index] = event.target.value; onChange(next); }} /></label>)}</div></div>;
}

function CapacityStep({ summary, value, assessment, disabled, onChange }: { summary: WeeklyReviewSummary; value: string; assessment: ReturnType<typeof assessWeeklyCapacity>; disabled: boolean; onChange: (value: string) => void }) {
  const message = assessment.level === "unknown" ? "如未能估算，下星期也可以先保留空白。" : assessment.level === "over_capacity" ? "已排定工作的已知預估超過你填寫的可用時間。你可保留這個訊號，稍後選擇延期、拆小或交接；系統不會自行改動。" : assessment.level === "tight" ? "時間接近上限，建議預留一些 buffer，毋須塞滿。" : "已知預估仍在你填寫的時間內；也可以保留 buffer。";
  return <div><h2 className="text-xl font-bold">下星期可用時間</h2><p className="muted mt-2">已排定日期的任務估計共約 {summary.known_estimated_minutes} 分鐘；這不是考核，只作溫和提示。</p><label className="mt-5 block max-w-sm"><span className="label">你實際可用分鐘（可留空）</span><input className="field mt-2" disabled={disabled} inputMode="numeric" type="number" min="0" max="10080" value={value} placeholder="例如：360" onChange={(event) => onChange(event.target.value)} /></label><p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">{message}</p></div>;
}

function RebalancingStep({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const linkClass = "inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-base font-semibold text-slate-800 ring-1 ring-slate-200 transition hover:bg-slate-50";
  return <div><div className="flex items-start gap-3"><UsersRound className="h-6 w-6 text-violet-600" /><div><h2 className="text-xl font-bold">Derek／Suki 是否需要重新分工</h2><p className="muted mt-1">先記下要討論的事；不會在這裡自動交接。</p></div></div><textarea className="field mt-5 min-h-32" disabled={disabled} maxLength={2000} value={value} placeholder="例如：可否由 Derek 跟進電話；Suki 先處理文件第一步。" onChange={(event) => onChange(event.target.value)} /><div className="mt-4 flex flex-wrap gap-2"><Link className={linkClass} href="/sharing">到交辦中心，再決定是否交接</Link><Link className={linkClass} href="/tasks">查看任務後再決定</Link></div></div>;
}

function FinishStep({ form, disabled, onChange }: { form: ReviewForm; disabled: boolean; onChange: (patch: Partial<ReviewForm>) => void }) {
  return <div><h2 className="text-xl font-bold">下星期第一個最小行動</h2><p className="muted mt-2">只要寫下可以開始的一步。確認完成後，不會把任何工作自動加到 Today。</p><label className="mt-5 block"><span className="label">第一個最小行動</span><input className="field mt-2" disabled={disabled} maxLength={500} value={form.nextMinimumAction} placeholder="例如：星期一打開學校電郵，列出需回覆的三點" onChange={(event) => onChange({ nextMinimumAction: event.target.value })} /></label><label className="mt-4 block"><span className="label">可選備註</span><textarea className="field mt-2 min-h-28" disabled={disabled} maxLength={4000} value={form.reflection} placeholder="想為下星期的自己留下甚麼提醒？" onChange={(event) => onChange({ reflection: event.target.value })} /></label></div>;
}

function formFromReview(summary: WeeklyReviewSummary): ReviewForm {
  const outcomes = [...(summary.review?.next_week_outcomes ?? [])];
  while (outcomes.length < 3) outcomes.push("");
  return { outcomes: outcomes.slice(0, 3), availableMinutes: summary.review?.next_week_available_minutes?.toString() ?? "", rebalancingNote: summary.review?.rebalancing_note ?? "", nextMinimumAction: summary.review?.next_minimum_action ?? "", reflection: summary.review?.reflection ?? "" };
}

function emptyForm(): ReviewForm { return { outcomes: ["", "", ""], availableMinutes: "", rebalancingNote: "", nextMinimumAction: "", reflection: "" }; }

function formatWeek(start: string, end: string) { return `${start} 至 ${end}`; }
