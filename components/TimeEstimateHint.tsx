"use client";

import { useEffect, useState } from "react";
import { Clock3, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { loadTimeEstimateSuggestion } from "@/lib/control-api";
import type { TimeEstimateSuggestion } from "@/lib/types";

type Props = {
  sourceType: string;
  context: string;
  energyLevel: string;
  estimatedMinutes: string;
  onUse: (minutes: number) => void;
};

export function TimeEstimateHint({ sourceType, context, energyLevel, estimatedMinutes, onUse }: Props) {
  const [suggestion, setSuggestion] = useState<TimeEstimateSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const originalMinutes = Number(estimatedMinutes);
  const validEstimate = Number.isInteger(originalMinutes) && originalMinutes >= 1 && originalMinutes <= 14400;

  useEffect(() => {
    let active = true;
    if (!validEstimate) {
      setSuggestion(null);
      setError("");
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError("");
    void loadTimeEstimateSuggestion({ sourceType, context, energyLevel, estimatedMinutes: originalMinutes })
      .then((result) => {
        if (active) setSuggestion(result.suggestion);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "未能讀取個人估時建議。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [context, energyLevel, originalMinutes, sourceType, validEstimate]);

  if (!validEstimate) return null;

  return (
    <section className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3" aria-live="polite">
      <p className="flex items-center gap-1.5 text-sm font-bold text-indigo-950"><Clock3 className="h-4 w-4" />個人化估時建議</p>
      {loading ? <p className="mt-1 text-xs text-slate-600">正在比對你自己的過往紀錄…</p> : null}
      {!loading && !error && !suggestion ? <p className="mt-1 text-xs leading-5 text-slate-600">目前資料不足。累積至少 3 筆你自己有填預計及實際時間的紀錄後，系統才會提出建議。</p> : null}
      {error ? <p className="mt-1 text-xs font-semibold text-amber-900">{error}</p> : null}
      {suggestion ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <p className="text-slate-700">原始預計 <strong>{originalMinutes} 分鐘</strong>；按 {suggestion.basis} 的 {suggestion.sample_count} 筆紀錄，建議 <strong>{suggestion.suggested_minutes} 分鐘</strong>。</p>
          <Button type="button" variant="secondary" onClick={() => onUse(suggestion.suggested_minutes)}><Sparkles className="h-4 w-4" />採用建議</Button>
        </div>
      ) : null}
    </section>
  );
}
