import type { handoffSummary } from "@/lib/handoff-summary";

export function HandoffSummaryLines({ summary }: { summary: ReturnType<typeof handoffSummary> }) {
  return <ul aria-label="交接狀態及下一步" className="mt-3 space-y-2">
    {summary.lines.map(line => <li key={line.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
      <span className="block break-words font-bold text-slate-900">{line.next}</span>
      <span className="mt-0.5 block break-words text-slate-600">{line.state}
        {line.waitingUntil ? ` · 等候至 ${line.waitingUntil}` : ""}
        {line.proposedDate ? ` · 建議日期 ${line.proposedDate}` : ""}
      </span>
    </li>)}
  </ul>;
}
