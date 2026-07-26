"use client";

import { useState } from "react";
import { Brain, Check, ChevronDown, ChevronUp, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import type { Task } from "@/lib/types";
import type { TaskAnalysis } from "@/lib/ai/schemas";

export function TaskAIAnalysisPanel({
  task,
  currentUserId,
  onChanged
}: {
  task: Task;
  currentUserId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState<TaskAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const owner = (task.owner_id ?? task.user_id) === currentUserId;

  async function analyze() {
    setOpen(true);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/ai/analyze-task", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id })
      });
      const body = await response.json().catch(() => ({})) as {
        analysis?: TaskAnalysis;
        error?: string;
        source?: string;
      };
      if (!response.ok || !body.analysis) throw new Error(body.error || "未能分析任務。");
      setAnalysis(body.analysis);
      if (body.source === "rules_fallback") setMessage("AI 暫時未連接，現時係安全規則式建議。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能分析任務。");
    } finally {
      setBusy(false);
    }
  }

  async function applySuggestion() {
    if (!analysis || !owner) return;
    if (!window.confirm("確認用 AI 建議更新「下一步」同「預計時間」？其他資料不會改動。")) return;
    setBusy(true);
    setMessage("");
    try {
      await controlAction("update_task", {
        id: task.id,
        changes: {
          next_action: analysis.firstTenMinutes,
          estimated_minutes: analysis.estimatedMinutes
        }
      });
      setMessage("已按你確認更新下一步同預計時間。");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能套用建議。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="flex min-h-11 items-center gap-2 text-left text-sm font-extrabold text-slate-900" type="button" onClick={() => setOpen((current) => !current)}>
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-violet-700"><Brain className="h-4 w-4" /></span>
          AI 最省力路徑
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void analyze()}>
          <WandSparkles className="h-4 w-4" />{busy ? "分析中…" : analysis ? "重新分析" : "分析任務"}
        </Button>
      </div>
      {open && analysis ? (
        <div className="mt-3 rounded-xl bg-white p-4">
          <p className="text-sm font-bold text-slate-900">完成標準：{analysis.clarifiedOutcome}</p>
          <ol className="mt-3 space-y-2">
            {analysis.fastestPath.map((step, index) => (
              <li className="flex gap-3 text-sm text-slate-700" key={`${index}-${step.action}`}>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-extrabold text-violet-700">{index + 1}</span>
                <span><span className="font-semibold">{step.action}</span><span className="ml-2 text-xs text-slate-500">約 {step.minutes} 分鐘</span></span>
              </li>
            ))}
          </ol>
          <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            <span className="font-extrabold">頭 10 分鐘：</span>{analysis.firstTenMinutes}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-600"><span className="font-bold">停手位：</span>{analysis.stopCondition}</p>
          {analysis.effortReductionTips.length ? (
            <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
              {analysis.effortReductionTips.map((tip) => <li key={tip}>• {tip}</li>)}
            </ul>
          ) : null}
          {owner ? (
            <Button className="mt-3" type="button" variant="success" disabled={busy} onClick={() => void applySuggestion()}>
              <Check className="h-4 w-4" />套用第一步同估時
            </Button>
          ) : (
            <p className="mt-3 text-xs text-slate-500">你可以查看建議，但只有任務擁有人可以修改內容。</p>
          )}
        </div>
      ) : null}
      {open && !analysis && !busy ? (
        <p className="mt-2 text-xs leading-5 text-slate-600">
          分析只讀取呢一項任務，唔會讀完整 backlog 或自動改資料。請勿喺任務內放病人姓名、地址、電話、HKID 或完整醫療紀錄。
        </p>
      ) : null}
      {message ? <p className="mt-2 text-xs font-semibold text-slate-700" role="status">{message}</p> : null}
    </section>
  );
}
