"use client";

import { useRef, useState } from "react";
import { Download, FileUp, RefreshCcw, ShieldCheck } from "lucide-react";
import type { BackupEnvelope, BackupPreview } from "@/lib/backup";
import { Button } from "@/components/ui/Button";

const labels: Record<string, string> = {
  tasks: "任務", operatingItems: "工作項目", transactions: "交易", meetings: "會議",
  balances: "結餘", planning: "Today／規劃", capacityCheckins: "每日容量",
  checkpoints: "Restart Checkpoint", taskResources: "任務資源", recurrenceRules: "重複規則",
  dependencies: "任務依賴", milestones: "里程碑", weeklyReviews: "週檢視",
  focusSessions: "Focus 歷史", timeObservations: "估時觀察", notificationPreferences: "通知偏好",
  profile: "帳戶資料", settings: "Settings", "taskResources.storage": "Storage 資源",
  "checkpoints.archived": "已關閉任務的 checkpoint", "taskResources.archived": "已關閉任務的資源"
};

type Props = { onRestored: () => Promise<void> | void };

export function BackupRestorePanel({ onRestored }: Props) {
  const [message, setMessage] = useState("");
  const [downloading, setDownloading] = useState<"json" | "tasks" | "finance" | "">("");
  const [backup, setBackup] = useState<BackupEnvelope | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [processing, setProcessing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function download(format: "json" | "tasks" | "finance") {
    setMessage(""); setDownloading(format);
    try {
      await ensureSession();
      const search = format === "json" ? "format=json" : `format=csv&kind=${format === "finance" ? "finance" : "tasks"}`;
      const response = await fetch(`/api/backup?${search}`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(await errorMessage(response));
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? (format === "json" ? "derek-control-panel-backup.json" : "derek-control-panel-export.csv");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
      setMessage(format === "json" ? "完整 JSON 備份已下載。請存放於只有你可存取的安全位置。" : "CSV 匯出已下載。");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "未能建立匯出檔。請重試。"); }
    finally { setDownloading(""); }
  }

  async function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage(""); setBackup(null); setPreview(null); setAcknowledged(false); setConfirmation("");
    if (file.size > 5 * 1024 * 1024) { setMessage("備份檔過大，請選擇不超過 5 MB 的 JSON 備份。"); return; }
    setProcessing(true);
    try {
      const value = JSON.parse(await file.text()) as BackupEnvelope;
      await ensureSession();
      const response = await fetch("/api/backup", {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", backup: value })
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = await response.json() as BackupPreview;
      setBackup(value); setPreview(result);
      setMessage(result.canRestore ? "已完成安全預覽。你可以閱讀結果後決定是否還原。" : "此備份沒有可新增的資料。現有資料不會被改動。");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "未能讀取備份檔。請選擇由本系統匯出的 JSON。 "); }
    finally { setProcessing(false); }
  }

  async function restore() {
    if (!backup || !preview || !acknowledged || confirmation !== "RESTORE") return;
    setMessage(""); setProcessing(true);
    try {
      await ensureSession();
      const response = await fetch("/api/backup", {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", backup, acknowledged: true, confirmation: "RESTORE" })
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = await response.json() as { restored: Record<string, number> };
      const created = Object.values(result.restored).reduce((sum, value) => sum + Number(value || 0), 0);
      setMessage(created ? `已安全新增 ${created} 項資料；所有既有資料都沒有被覆蓋。` : "沒有需要新增的資料；所有既有資料都保持不變。");
      setBackup(null); setPreview(null); setAcknowledged(false); setConfirmation("");
      await onRestored();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "未能安全還原。沒有資料會被自動覆蓋，請重試。"); }
    finally { setProcessing(false); }
  }

  return <section className="panel grid gap-5 p-5" aria-labelledby="backup-restore-title">
    <div className="flex items-start gap-3">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><ShieldCheck className="h-5 w-5" /></div>
      <div><p className="eyebrow">Backup & Restore</p><h2 id="backup-restore-title" className="section-title mt-1">你的資料備份及安全還原</h2><p className="muted mt-2 text-sm leading-6">匯出只包括你本人擁有的資料。還原前必須先預覽，且只會新增缺少的項目，絕不覆蓋目前資料。</p></div>
    </div>

    <div className="grid gap-3 sm:grid-cols-3">
      <Button type="button" variant="secondary" disabled={Boolean(downloading)} onClick={() => void download("json")}><Download className="h-5 w-5" />{downloading === "json" ? "建立中…" : "完整 JSON 備份"}</Button>
      <Button type="button" variant="secondary" disabled={Boolean(downloading)} onClick={() => void download("tasks")}><Download className="h-5 w-5" />{downloading === "tasks" ? "建立中…" : "任務 CSV"}</Button>
      <Button type="button" variant="secondary" disabled={Boolean(downloading)} onClick={() => void download("finance")}><Download className="h-5 w-5" />{downloading === "finance" ? "建立中…" : "財務 CSV"}</Button>
    </div>
    <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">JSON 不包括密碼、登入資料、另一位使用者的資料、分享權限、推送裝置和 Storage 檔案本體。CSV 會把以「=、+、-、@」開頭的文字安全保留為純文字。</p>

    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-bold text-slate-900">從 JSON 備份還原</h3><p className="muted mt-1 text-sm leading-6">先讀取及比較備份；你仍可隨時取消。此功能不會重設資料庫，也不會改動現有項目。</p></div><Button type="button" variant="secondary" disabled={processing} onClick={() => inputRef.current?.click()}><FileUp className="h-5 w-5" />{processing ? "檢查中…" : "選擇 JSON 備份"}</Button></div>
      <input ref={inputRef} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void selectFile(event)} />

      {preview ? <div className="mt-4 grid gap-4 border-t border-slate-200 pt-4">
        <div><p className="label">備份內容</p><div className="mt-2 flex flex-wrap gap-2">{Object.entries(preview.recordCounts).filter(([, count]) => count > 0).map(([key, count]) => <span key={key} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{labels[key] ?? key} {count}</span>)}</div></div>
        {preview.conflicts.length ? <div className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900"><p className="font-bold">已找到現有資料</p><p className="mt-1">{preview.conflicts.map((entry) => `${labels[entry.category] ?? entry.category} ${entry.count}`).join("、")}。這些項目不會被覆蓋，還原時會略過。</p></div> : <p className="rounded-xl bg-emerald-50 p-3 text-sm leading-6 text-emerald-900">未發現相同 ID 的本人資料；還原仍會以「只新增、不覆蓋」方式執行。</p>}
        {preview.unsupported.length ? <div className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700"><p className="font-bold">此版本會保留、但不自動還原</p><ul className="mt-2 list-disc space-y-1 pl-5">{preview.unsupported.map((entry) => <li key={entry.category}>{labels[entry.category] ?? entry.category}（{entry.count}）：{entry.reason}</li>)}</ul></div> : null}
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm leading-6"><input className="mt-1 h-5 w-5" type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>我明白：還原只會新增缺少項目，不會覆蓋、刪除或重設任何現有資料。</span></label>
        <label><span className="label">輸入 RESTORE 以啟用還原</span><input className="field mt-2" value={confirmation} onChange={(event) => setConfirmation(event.target.value.trim().toUpperCase())} placeholder="RESTORE" autoComplete="off" /></label>
        <div><Button type="button" variant="secondary" disabled={processing || !preview.canRestore || !acknowledged || confirmation !== "RESTORE"} onClick={() => void restore()}><RefreshCcw className="h-5 w-5" />{processing ? "安全還原中…" : "只新增，不覆蓋地還原"}</Button></div>
      </div> : null}
    </div>
    {message ? <p className="text-sm font-semibold leading-6 text-slate-700" role="status">{message}</p> : null}
  </section>;
}

async function ensureSession() {
  const response = await fetch("/api/auth", { method: "GET", cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error("登入已失效，請重新登入。");
}

async function errorMessage(response: Response) {
  const result = await response.json().catch(() => ({})) as { error?: string };
  return result.error || "操作未能完成，請稍後重試。";
}
