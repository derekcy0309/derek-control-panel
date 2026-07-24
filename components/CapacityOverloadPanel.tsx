"use client";

import { CalendarClock, Gauge, TimerReset, UserRoundCheck } from "lucide-react";
import type { CapacityOverloadAssessment } from "@/lib/capacity-overload";
import type { Task } from "@/lib/types";
import { Button } from "@/components/ui/Button";

export function CapacityOverloadPanel({
  assessment,
  handoffTargetName,
  onPostpone,
  onHandoff
}: {
  assessment: CapacityOverloadAssessment;
  handoffTargetName?: string;
  onPostpone: (task: Task) => void;
  onHandoff: (task: Task) => void;
}) {
  if (!assessment.needsAttention) return null;
  return <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5" aria-labelledby="capacity-overload-title">
    <div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-amber-700"><Gauge className="h-5 w-5" /></div><div><p className="eyebrow text-amber-800">Capacity check</p><h2 id="capacity-overload-title" className="section-title mt-1">可以先收窄一點承諾</h2><p className="mt-2 text-sm leading-6 text-amber-950">這只是幫你看見容量的建議；系統不會自動延期、交接或改動任何任務。</p></div></div>
    <ul className="mt-4 grid gap-2 text-sm leading-6 text-slate-700">{assessment.reasons.slice(0, 4).map((reason) => <li key={reason} className="rounded-xl bg-white/80 p-3">{reason}</li>)}</ul>
    <div className="mt-4 grid gap-3 lg:grid-cols-2"><LoadSummary icon={<CalendarClock className="h-4 w-4" />} label="今日" load={assessment.today} /><LoadSummary icon={<Gauge className="h-4 w-4" />} label="本週剩餘" load={assessment.week} /></div>
    {assessment.deferCandidates.length ? <div className="mt-4 border-t border-amber-200 pt-4"><p className="font-bold text-slate-900">可考慮延後的低影響工作</p><p className="muted mt-1 text-sm">只列出沒有安全、子女、法律、收入或關鍵路徑影響的未開始工作。</p><div className="mt-3 grid gap-2">{assessment.deferCandidates.map((task) => <div key={task.id} className="flex flex-col gap-2 rounded-xl bg-white/80 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-slate-900">{task.title}</p><p className="muted mt-1 text-xs">約 {task.estimated_minutes ?? 25} 分鐘{task.due_date ? ` · 到期 ${task.due_date}` : ""}</p></div><Button type="button" variant="secondary" onClick={() => onPostpone(task)}><TimerReset className="h-4 w-4" />選日期再安排</Button></div>)}</div></div> : null}
    {assessment.handoffCandidates.length && handoffTargetName ? <div className="mt-4 rounded-xl bg-white/80 p-3"><p className="font-bold text-slate-900">如需要，可請對方接手一個低影響步驟</p><p className="muted mt-1 text-sm">交接會開啟 notes 及確認畫面，不會自動發送。</p><Button className="mt-3" type="button" variant="secondary" onClick={() => onHandoff(assessment.handoffCandidates[0])}><UserRoundCheck className="h-4 w-4" />請 {handoffTargetName} 接手「{assessment.handoffCandidates[0].title}」</Button></div> : null}
  </section>;
}

function LoadSummary({ icon, label, load }: { icon: React.ReactNode; label: string; load: CapacityOverloadAssessment["today"] }) {
  const summary = load.availableMinutes === null ? "未設定可用時間" : load.level === "over_capacity" ? `超出約 ${load.overByMinutes} 分鐘` : load.level === "tight" ? "接近容量上限" : "仍有一些空間";
  return <div className="rounded-xl bg-white/80 p-3 text-sm"><p className="flex items-center gap-2 font-bold text-slate-900">{icon}{label}</p><p className="mt-1 text-slate-700">{summary}</p><p className="muted mt-1">已知工作 {load.committedMinutes} 分鐘 · buffer {load.bufferMinutes} 分鐘</p></div>;
}
