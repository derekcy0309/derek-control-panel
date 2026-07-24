"use client";

import { useCallback, useEffect, useState } from "react";
import { History, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { loadFocusSessions } from "@/lib/control-api";
import type { FocusSession } from "@/lib/types";

export function FocusSessionHistory({ taskId, refreshKey }: { taskId: string; refreshKey: number }) {
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await loadFocusSessions(taskId);
      setSessions(result.sessions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能讀取專注紀錄。");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <details className="mt-7 rounded-2xl border border-white/10 p-4">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-white/65"><History className="h-4 w-4" />我的專注紀錄</summary>
      <p className="mt-2 text-xs leading-5 text-white/50">用於估時與下次接續，不會成為 Derek／Suki 的產量比較。</p>
      {loading ? <p className="mt-3 text-sm text-white/60">正在讀取…</p> : null}
      {error ? <div className="mt-3 flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-amber-100">{error}</p><Button type="button" variant="secondary" onClick={() => void load()}><RotateCw className="h-4 w-4" />重試</Button></div> : null}
      {!loading && !error && sessions.length === 0 ? <p className="mt-3 text-sm text-white/60">這項任務尚未有專注紀錄。</p> : null}
      {!loading && !error && sessions.length ? <div className="mt-3 space-y-2">{sessions.map((session) => <SessionRow key={session.id} session={session} />)}</div> : null}
    </details>
  );
}

function SessionRow({ session }: { session: FocusSession }) {
  const pauseMinutes = Math.ceil(session.paused_seconds / 60);
  return <article className="rounded-xl bg-white/[.06] p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{formatTimestamp(session.started_at)}</p><span className="rounded-full bg-white/10 px-2 py-1 text-xs font-bold text-white/75">{statusLabel[session.status]}</span></div><p className="mt-2 text-white/65">計劃 {session.planned_minutes} 分鐘{session.actual_minutes ? ` · 實際 ${session.actual_minutes} 分鐘` : ""}{pauseMinutes ? ` · 暫停 ${pauseMinutes} 分鐘` : ""}{session.interruption_count ? ` · 中斷 ${session.interruption_count} 次` : ""}</p>{session.checkpoint_id ? <p className="mt-1 text-xs text-indigo-200">已連結 checkpoint</p> : null}{session.block_reason ? <p className="mt-1 text-xs text-amber-100">阻塞：{session.block_reason}</p> : null}</article>;
}

const statusLabel: Record<FocusSession["status"], string> = { running: "進行中", paused: "已暫停", completed: "完成", partial: "部分完成", interrupted: "中斷" };
function formatTimestamp(value: string) { return new Intl.DateTimeFormat("zh-HK", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
