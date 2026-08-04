"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { TaskCard } from "@/components/items/TaskCard";
import { loadTaskDetail } from "@/lib/control-api";
import type { TaskDetailData } from "@/lib/types";

export default function TaskDetailPage() {
  return <AuthGate><TaskDetailContent /></AuthGate>;
}

function TaskDetailContent() {
  const params = useParams<{ id: string }>();
  const taskId = typeof params.id === "string" ? params.id : "";
  const [data, setData] = useState<TaskDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError("");
    try {
      setData(await loadTaskDetail(taskId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能讀取任務詳情。");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { void reload(); }, [reload]);
  if (loading || error || !data) return <LoadingState error={error} />;
  const participantById = new Map(data.participants.map((person) => [person.user_id, person.display_name]));

  return (
    <main className="mx-auto max-w-5xl space-y-4">
      <Link className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 font-semibold text-slate-700 hover:bg-white" href="/tasks"><ArrowLeft className="h-4 w-4" />返回任務</Link>
      <section>
        <p className="eyebrow">Task Detail</p>
        <h1 className="page-title mt-1">完整任務內容</h1>
        <p className="muted mt-2 text-sm">主頁只顯示摘要；這裡保留交接、checkpoint、資源、歷史及所有工作細節。</p>
      </section>
      <TaskCard
        task={data.task}
        currentUserId={data.currentUser.id}
        participants={data.participants}
        assignments={data.assignments}
        handoffNotes={data.handoffNotes}
        allTasks={[data.task]}
        taskDependencies={data.taskDependencies}
        taskRecurrenceRules={data.taskRecurrenceRules}
        onChanged={() => { void reload(); }}
        prominent
        detailLink={false}
      />
      <details className="panel group overflow-hidden">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4"><span><span className="block font-extrabold text-slate-900">歷史紀錄</span><span className="mt-1 block text-xs text-slate-500">顯示建立、交接、更新、確認及完成的 audit log；預設收起。</span></span><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-700">{data.activityLogs.length}</span></summary>
        <div className="border-t border-slate-100 p-4 sm:p-5">
          {data.activityLogs.length ? <ol className="space-y-3">{data.activityLogs.map((entry) => <li className="rounded-xl bg-slate-50 p-3 text-sm" key={entry.id}><p className="font-bold text-slate-900">{entry.summary || entry.action}</p><p className="mt-1 text-xs text-slate-500">{participantById.get(entry.actor_id) ?? (entry.actor_id === data.currentUser.id ? data.currentUser.displayName : "已授權使用者")} · {new Date(entry.created_at).toLocaleString("zh-HK")}</p></li>)}</ol> : <p className="text-sm text-slate-500">暫時未有歷史紀錄。</p>}
        </div>
      </details>
    </main>
  );
}
