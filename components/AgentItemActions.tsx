"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AgentItem, AgentStatus } from "@/lib/agent-access";

type EditableItem = AgentItem & { editable?: boolean; archive_requestable?: boolean };
const statuses = {
  not_started: "未開始", in_progress: "進行中", waiting: "等待中",
  blocked: "有阻滯", done: "已完成", cancelled: "已取消"
} as const;
type Draft = { title: string; description: string; dueDate: string; priority: string; status: string; tagIds: string[]; category: string };

function initial(item: EditableItem): Draft {
  return {
    title: item.title, description: item.description ?? "", dueDate: item.due_date ?? "",
    priority: item.requested_priority === undefined ? "" : String(item.requested_priority),
    status: item.status ?? "", tagIds: item.tags?.map(tag => tag.id) ?? [], category: item.category ?? ""
  };
}

export function AgentItemActions({ session, item, onUpdated, onUnauthorized }: {
  session: AgentStatus;
  item: EditableItem;
  onUpdated: () => Promise<void>;
  onUnauthorized: (error: unknown) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "archive">("view");
  const [original] = useState(() => initial(item));
  const [draft, setDraft] = useState<Draft>(original);
  const [busy, setBusy] = useState(false);
  const [archiveSent, setArchiveSent] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const lastEdit = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const allowedEdit = session.permissions.update && item.editable !== false;
  const allowedArchive = session.permissions.requestArchive === true && item.archive_requestable !== false;

  const changes: Record<string, unknown> = {};
  if (draft.title !== original.title) changes.title = draft.title.trim();
  if (draft.description !== original.description) changes.description = draft.description.trim();
  if (item.kind === "task") {
    if (draft.dueDate !== original.dueDate) changes.dueDate = draft.dueDate || null;
    if (draft.priority !== original.priority) changes.priority = Number(draft.priority);
    if (draft.status !== original.status) changes.status = draft.status;
    if (draft.tagIds.length !== original.tagIds.length || draft.tagIds.some(id => !original.tagIds.includes(id))) changes.tagIds = draft.tagIds;
  } else if (draft.category !== original.category) changes.category = draft.category.trim();
  const hasChanges = Object.keys(changes).length > 0;

  function switchMode(next: typeof mode) {
    setError("");
    setMode(next);
    if (next === "edit") setDraft(original);
  }

  async function send(operation: "edit" | "archive") {
    if (inFlight.current || mode !== operation) return;
    if (operation === "edit" && (!allowedEdit || !hasChanges || !draft.title.trim())) return;
    if (operation === "archive" && (!allowedArchive || archiveSent)) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const fingerprint = JSON.stringify(changes);
      if (operation === "edit" && lastEdit.current?.fingerprint !== fingerprint) {
        lastEdit.current = { fingerprint, requestId: crypto.randomUUID() };
      }
      const payload = operation === "edit"
        ? { kind: item.kind, id: item.id, requestId: lastEdit.current?.requestId, changes }
        : { action: "request_archive", kind: item.kind, id: item.id };
      const response = await fetch("/api/agent", {
        method: operation === "edit" ? "PATCH" : "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok || (operation === "archive" && (response.status !== 202 || value.status !== "pending"))) {
        throw Object.assign(new Error(value.error || "暫時未能核對結果，請重試。"), { status: response.status });
      }
      if (operation === "edit") await onUpdated();
      else {
        setArchiveSent(true);
        setMode("view");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "暫時未能核對結果，請重試。");
      if ((caught as { status?: number })?.status === 401) onUnauthorized(caught);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!allowedEdit && !allowedArchive) {
    return <p className="muted text-xs">此項目只可讀取，不能修改或提出封存。</p>;
  }
  return <div className="grid gap-3 border-t border-slate-200 pt-3">
    {error ? <p role="alert" className="text-sm font-semibold">{error}</p> : null}
    {archiveSent ? <p role="status" className="muted text-sm">已交俾擁有人核對。項目未封存，須由本人登入確認。</p> : null}
    {mode === "view" ? <div className="flex flex-wrap gap-2">
      {allowedEdit ? <Button type="button" variant="secondary" onClick={() => switchMode("edit")}>修改{item.kind === "task" ? " Task" : "筆記"}</Button> : null}
      {allowedArchive && !archiveSent ? <Button type="button" variant="secondary" onClick={() => switchMode("archive")}>提出封存建議</Button> : null}
    </div> : null}
    {mode === "archive" ? <div className="grid gap-2">
      <p className="muted text-sm leading-6">只有擁有人要求先提出建議。提交唔會改動資料；擁有人須登入逐項確認。已共用或連接其他資料嘅項目可能唔合資格。</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void send("archive")}>{busy ? "提交中…" : "提交封存建議"}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => switchMode("view")}>取消</Button>
      </div>
    </div> : null}
    {mode === "edit" ? <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void send("edit"); }}>
      <fieldset disabled={busy} className="grid gap-3">
        <legend className="font-semibold">修改內容</legend>
        <label><span className="label">名稱</span><input className="field mt-2" value={draft.title} maxLength={500} required onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label><span className="label">內容（可留空）</span><textarea className="field mt-2 min-h-28" value={draft.description} maxLength={10000} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
        {item.kind === "task" ? <>
          <div className="grid gap-3 sm:grid-cols-3">
            <label><span className="label">完成日期（可留空）</span><input className="field mt-2" type="date" value={draft.dueDate} onChange={event => setDraft({ ...draft, dueDate: event.target.value })} /></label>
            <label><span className="label">Priority</span><select className="field mt-2" value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value })}>
              {["1", "3", "5"].includes(original.priority) ? null : <option value={original.priority}>沿用原本 Priority</option>}
              <option value="1">高</option><option value="3">一般</option><option value="5">低</option>
            </select></label>
            <label><span className="label">狀態</span><select className="field mt-2" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}>
              {Object.hasOwn(statuses, original.status) ? null : <option value={original.status}>沿用原本狀態</option>}
              {Object.entries(statuses).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select></label>
          </div>
          {session.tags.length ? <fieldset><legend className="label">Task Tags（可留空）</legend>
            <div className="flex flex-wrap gap-2">{session.tags.map(tag => <Button type="button" key={tag.id}
              variant={draft.tagIds.includes(tag.id) ? "primary" : "secondary"} aria-pressed={draft.tagIds.includes(tag.id)}
              onClick={() => setDraft(previous => ({ ...previous, tagIds: previous.tagIds.includes(tag.id) ? previous.tagIds.filter(id => id !== tag.id) : [...previous.tagIds, tag.id] }))}>{tag.name}</Button>)}</div>
          </fieldset> : null}
        </> : <label><span className="label">分類（可留空）</span><input className="field mt-2" value={draft.category} maxLength={40} onChange={event => setDraft({ ...draft, category: event.target.value })} /></label>}
      </fieldset>
      {item.kind === "task" ? <p className="muted text-xs leading-5">期限同狀態仍須符合原本排程、共用同重複工作規則。</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !hasChanges || !draft.title.trim()}>{busy ? "儲存中…" : "儲存修改"}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => switchMode("view")}>取消</Button>
      </div>
    </form> : null}
  </div>;
}
