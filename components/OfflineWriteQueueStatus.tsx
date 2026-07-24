"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import {
  discardConflictedOfflineWrites,
  getOfflineQueueStatus,
  subscribeOfflineQueue,
  synchronizeOfflineWrites,
  type OfflineQueueStatus
} from "@/lib/offline-write-queue";

const emptyStatus: OfflineQueueStatus = { queued: 0, conflicts: 0, online: true };

export function OfflineWriteQueueStatus({ userId }: { userId: string | null }) {
  const [status, setStatus] = useState<OfflineQueueStatus>(emptyStatus);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async (sync = false) => {
    if (!userId) return;
    const current = await getOfflineQueueStatus(userId).catch(() => emptyStatus);
    setStatus(current);
    if (!sync || !current.online || !current.queued) return;
    setSyncing(true);
    const next = await synchronizeOfflineWrites(userId).catch(() => current);
    setStatus(next);
    setSyncing(false);
  }, [userId]);

  useEffect(() => {
    void refresh(true);
    return subscribeOfflineQueue(() => { void refresh(true); });
  }, [refresh]);

  if (!userId || (status.online && !status.queued && !status.conflicts)) return null;

  if (status.conflicts) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900" role="status">
        <TriangleAlert className="h-4 w-4 shrink-0" />
        <span>{status.conflicts} 筆離線寫入需要重新確認；未有覆蓋現有資料。</span>
        <button className="underline underline-offset-2" onClick={() => void discardConflictedOfflineWrites(userId).then(() => refresh())}>捨棄本機副本</button>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${status.online ? "bg-indigo-50 text-indigo-800" : "bg-slate-100 text-slate-700"}`} role="status">
      <CloudOff className="h-4 w-4 shrink-0" />
      <span>{status.online ? `${status.queued} 筆內容正在安全同步` : `${status.queued} 筆內容已保留在此裝置，待連線後同步`}</span>
      {status.online ? <button className="underline underline-offset-2" onClick={() => void refresh(true)} disabled={syncing}>{syncing ? "同步中…" : <><RefreshCw className="mr-1 inline h-3.5 w-3.5" />重試</>}</button> : null}
    </div>
  );
}
