"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, FilePenLine, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { loadTaskCheckpoints } from "@/lib/control-api";
import type { TaskCheckpoint, TaskCheckpointBundle } from "@/lib/types";

type Props = {
  taskId: string;
  participants: Array<{ user_id: string; display_name: string }>;
};

// Checkpoints are fetched only after the user opens this panel. Rendering a
// long task list must not create one network request per card.
export function TaskCheckpointNotesPanel({ taskId, participants }: Props) {
  const [open, setOpen] = useState(false);
  const [bundle, setBundle] = useState<TaskCheckpointBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function authorName(authorId: string) {
    return participants.find((participant) => participant.user_id === authorId)?.display_name ?? "任務參與者";
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      setBundle(await loadTaskCheckpoints(taskId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能讀取專注進度，請再試一次。");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !bundle && !loading) void load();
  }

  return (
    <section className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3" aria-label="專注進度與 notes">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-extrabold text-slate-900"><FilePenLine className="h-4 w-4 text-indigo-700" />專注進度／notes</h4>
          <p className="mt-1 text-xs leading-5 text-slate-600">專注模式記下的工作位置會在這裡保留，不會覆蓋一般「備註」。</p>
        </div>
        <Button type="button" variant="secondary" onClick={toggle} disabled={loading} aria-expanded={open}>
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {loading ? "讀取中…" : open ? "收起" : "查看進度"}
        </Button>
      </div>

      {open && error ? (
        <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">
          <p>未能讀取專注 notes：{error}</p>
          <Button className="mt-2" type="button" variant="secondary" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" />再試一次</Button>
        </div>
      ) : null}

      {open && !loading && !error && bundle ? <CheckpointContents bundle={bundle} authorName={authorName} /> : null}
    </section>
  );
}

function CheckpointContents({
  bundle,
  authorName
}: {
  bundle: TaskCheckpointBundle;
  authorName: (authorId: string) => string;
}) {
  if (!bundle.latest && !bundle.draft) {
    return <p className="mt-3 rounded-lg bg-white p-3 text-sm leading-6 text-slate-600">暫時未有專注 notes。下次在專注模式按「記錄進度」或完成任務後，工作位置會在此顯示。</p>;
  }

  return (
    <div className="mt-3 space-y-3">
      {bundle.draft ? (
        <CheckpointBlock
          checkpoint={bundle.draft}
          title="你的未交差草稿"
          caption="只有你可見；仍可返回專注模式繼續寫或正式儲存。"
          authorName={authorName}
          draft
        />
      ) : null}
      {bundle.latest ? <CheckpointBlock checkpoint={bundle.latest} title="最新已交差進度" authorName={authorName} /> : null}
      {bundle.history.length > 1 ? (
        <details className="rounded-lg border border-indigo-100 bg-white p-3">
          <summary className="cursor-pointer text-sm font-bold text-slate-700">查看較早記錄（{bundle.history.length - 1}）</summary>
          <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
            {bundle.history.slice(1).map((checkpoint) => <CheckpointBlock key={checkpoint.id} checkpoint={checkpoint} title="較早記錄" authorName={authorName} />)}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function CheckpointBlock({
  checkpoint,
  title,
  caption,
  authorName,
  draft = false
}: {
  checkpoint: TaskCheckpoint;
  title: string;
  caption?: string;
  authorName: (authorId: string) => string;
  draft?: boolean;
}) {
  return (
    <article className={draft ? "rounded-lg border border-dashed border-indigo-300 bg-white p-3" : "rounded-lg bg-white p-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-extrabold text-slate-900">{title}</p>
        <p className="text-xs text-slate-500">{formatCheckpointTime(checkpoint.last_worked_at)} · {authorName(checkpoint.author_id)}</p>
      </div>
      {caption ? <p className="mt-1 text-xs leading-5 text-slate-500">{caption}</p> : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <NoteItem label="剛完成" value={checkpoint.completed_summary} />
        <NoteItem label="現在做到哪裡" value={checkpoint.current_position} />
        <NoteItem label="下一個最小步驟" value={checkpoint.next_minimum_step} accent />
        <NoteItem label="阻塞原因" value={checkpoint.blocked_reason} />
      </div>
    </article>
  );
}

function NoteItem({ label, value, accent = false }: { label: string; value: string | null; accent?: boolean }) {
  if (!value) return null;
  return (
    <div className={`rounded-md p-2.5 ${accent ? "bg-indigo-50" : "bg-slate-50"}`}>
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{value}</p>
    </div>
  );
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
