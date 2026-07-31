"use client";

import { ArrowUpRight, History, RefreshCw, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { CheckpointForm } from "@/lib/checkpoints";
import type { TaskCheckpoint } from "@/lib/types";
import type { CheckpointSaveState } from "@/hooks/useTaskCheckpoint";

type Props = {
  latest: TaskCheckpoint | null;
  history: TaskCheckpoint[];
  form: CheckpointForm;
  loading: boolean;
  loadError: string;
  saveError: string;
  saveState: CheckpointSaveState;
  busy: boolean;
  editorOpen: boolean;
  exitRequested: boolean;
  sharedTask: boolean;
  authorName: (authorId: string) => string;
  onUpdate: <K extends keyof CheckpointForm>(field: K, value: CheckpointForm[K]) => void;
  onResume: (checkpoint: TaskCheckpoint) => void;
  onRetryLoad: () => void;
  onRetrySave: () => void;
  onSave: () => void;
  onCancelExit: () => void;
};

export function RestartCheckpointPanel({
  latest,
  history,
  form,
  loading,
  loadError,
  saveError,
  saveState,
  busy,
  editorOpen,
  exitRequested,
  sharedTask,
  authorName,
  onUpdate,
  onResume,
  onRetryLoad,
  onRetrySave,
  onSave,
  onCancelExit
}: Props) {
  return (
    <>
      <section className="mt-6 rounded-2xl border border-indigo-300/25 bg-indigo-400/[.08] p-5" aria-labelledby="latest-checkpoint-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.14em] text-indigo-300">Restart Checkpoint</p>
            <h2 id="latest-checkpoint-title" className="mt-1 text-lg font-bold">上次工作位置</h2>
          </div>
          {latest ? <p className="text-xs text-white/55">{formatCheckpointTime(latest.last_worked_at)} · {authorName(latest.author_id)}</p> : null}
        </div>

        {loading ? <p className="mt-4 text-sm text-white/65">正在安全載入上次記錄…</p> : null}
        {loadError ? (
          <div className="mt-4 rounded-xl bg-amber-300/10 p-3 text-sm text-amber-100" role="alert">
            <p className="font-semibold">未能載入 checkpoint：{loadError}</p>
            <button className="mt-2 inline-flex min-h-11 items-center gap-2 font-bold underline underline-offset-4" onClick={onRetryLoad}>
              <RefreshCw className="h-4 w-4" />再試一次
            </button>
          </div>
        ) : null}
        {!loading && !loadError && latest ? (
          <div className="mt-4 space-y-4">
            <CheckpointSummary checkpoint={latest} />
            <div className="flex flex-wrap gap-2">
              {latest.resource_links.map((resource) => (
                <a
                  key={`${latest.id}-${resource.url}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-900 hover:bg-indigo-50"
                  href={resource.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {resource.label}<ArrowUpRight className="h-4 w-4" />
                </a>
              ))}
              {latest.next_minimum_step ? <Button className="bg-indigo-400 text-slate-950 hover:bg-indigo-300" onClick={() => onResume(latest)}>從這裡繼續</Button> : null}
            </div>
            {history.length > 1 ? (
              <details className="rounded-xl border border-white/10 p-3">
                <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-white/70">
                  <History className="h-4 w-4" />查看較早記錄（{history.length - 1}）
                </summary>
                <div className="mt-2 divide-y divide-white/10">
                  {history.filter((checkpoint) => checkpoint.id !== latest.id).map((checkpoint) => (
                    <article key={checkpoint.id} className="py-4">
                      <p className="mb-3 text-xs text-white/45">{formatCheckpointTime(checkpoint.last_worked_at)} · {authorName(checkpoint.author_id)}</p>
                      <CheckpointSummary checkpoint={checkpoint} />
                    </article>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
        {!loading && !loadError && !latest ? <p className="mt-4 text-sm leading-6 text-white/65">暫時未有正式記錄。完成一小步或暫停時，下面的簡短 checkpoint 會令下次更容易開始。</p> : null}
      </section>

      {editorOpen ? (
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[.06] p-5" aria-labelledby="checkpoint-editor-title" aria-busy={busy}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.14em] text-indigo-300">Leave a clear trail</p>
              <h2 id="checkpoint-editor-title" className="mt-1 text-lg font-bold">{exitRequested ? "離開前記下工作位置" : "記錄目前工作位置"}</h2>
            </div>
            <SaveStatus state={saveState} error={saveError} onRetry={onRetrySave} />
          </div>
          <p className="mt-3 text-sm leading-6 text-white/60">草稿會自動保存；顯示「草稿已安全儲存」才代表已寫入伺服器。離線時會清楚標示為只保留在此裝置、等待同步。</p>

          <div className="mt-5 grid gap-4">
            <CheckpointField label="我剛才完成了甚麼" value={form.completedSummary} maxLength={4000} onChange={(value) => onUpdate("completedSummary", value)} />
            <CheckpointField label="現在做到哪裡" value={form.currentPosition} maxLength={4000} onChange={(value) => onUpdate("currentPosition", value)} />
            <CheckpointField label="下一個最小步驟" value={form.nextMinimumStep} maxLength={2000} onChange={(value) => onUpdate("nextMinimumStep", value)} placeholder="例如：打開報價表，先核對第一行數字" />
            <CheckpointField label="下次需要打開的文件／網址／頁面" value={form.resourceLinksText} maxLength={12000} onChange={(value) => onUpdate("resourceLinksText", value)} placeholder={"每行一個 HTTPS 網址\n可用：名稱 | https://example.com"} />
            <p className="-mt-2 rounded-xl bg-white/[.05] p-3 text-xs leading-5 text-white/55">
              資源連結只會向建立這筆記錄的本人顯示；日後分享任務亦不會自動分享這些私人網址。
              {sharedTask ? " 對方仍可看到正式 checkpoint 的進度文字，方便交接。" : ""}
            </p>
            <CheckpointField label="目前阻塞原因（如有）" value={form.blockedReason} maxLength={2000} onChange={(value) => onUpdate("blockedReason", value)} />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={onSave} disabled={busy || saveState === "saving"}><Save className="h-5 w-5" />{busy || saveState === "saving" ? "正在安全儲存…" : exitRequested ? "儲存並離開" : "儲存 checkpoint"}</Button>
            {exitRequested ? <Button variant="secondary" onClick={onCancelExit} disabled={busy}><Undo2 className="h-5 w-5" />先留在這裡</Button> : null}
          </div>
        </section>
      ) : null}
    </>
  );
}

function CheckpointSummary({ checkpoint }: { checkpoint: TaskCheckpoint }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SummaryItem label="上次做到" value={checkpoint.current_position || checkpoint.completed_summary || "未填寫"} />
      <SummaryItem label="立即下一步" value={checkpoint.next_minimum_step || "未填寫"} accent />
      {checkpoint.completed_summary ? <SummaryItem label="剛完成" value={checkpoint.completed_summary} /> : null}
      {checkpoint.blocked_reason ? <SummaryItem label="阻塞原因" value={checkpoint.blocked_reason} /> : null}
    </div>
  );
}

function SummaryItem({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${accent ? "bg-indigo-300/15" : "bg-black/15"}`}>
      <p className="text-xs font-bold uppercase tracking-[.12em] text-white/45">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-6 text-white/85">{value}</p>
    </div>
  );
}

function CheckpointField({
  label,
  value,
  maxLength,
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  maxLength: number;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="text-sm font-bold text-white/75">{label}</span>
      <textarea
        className="mt-2 min-h-24 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-3 text-base text-white outline-none placeholder:text-white/30 focus:border-indigo-300"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SaveStatus({ state, error, onRetry }: { state: CheckpointSaveState; error: string; onRetry: () => void }) {
  if (state === "error") {
    return (
      <button className="min-h-11 rounded-xl bg-amber-300/15 px-3 text-left text-xs font-bold text-amber-100" onClick={onRetry} role="alert">
        儲存失敗：{error || "請再試一次"} · 按此重試
      </button>
    );
  }
  const label = state === "saving"
    ? "自動儲存中…"
    : state === "pending"
      ? "有未儲存變更"
      : state === "queued"
        ? "已保留在此裝置，待連線安全同步"
      : state === "saved"
        ? "草稿已安全儲存"
        : "尚未修改";
  return <p className="min-h-11 rounded-xl bg-black/15 px-3 py-3 text-xs font-bold text-white/55" aria-live="polite">{label}</p>;
}

function formatCheckpointTime(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
