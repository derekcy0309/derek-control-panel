"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { formatDate } from "@/lib/date";
import { taskCategoryFor } from "@/lib/task-categories";
import type { Task } from "@/lib/types";

export function ChildTasksPanel({ parent, childTasks, participants, currentUserId, onCreated }: {
  parent: Task;
  childTasks: Task[];
  participants: Array<{ user_id: string; display_name: string }>;
  currentUserId: string;
  onCreated: (task: Task) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(parent.due_date ?? "");
  const [assigneeId, setAssigneeId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);
  const canCreate = (parent.owner_id ?? parent.user_id) === currentUserId && !["done", "cancelled"].includes(parent.status);
  const otherParticipants = participants.filter((person) => person.user_id !== currentUserId);

  async function createChild(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !title.trim()) return;
    setBusy(true);
    setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      const created = await controlAction<{ task: Task }>("create_task", {
        clientRequestId: requestId.current,
        parentTaskId: parent.id,
        title: title.trim(),
        taskCategory: taskCategoryFor(parent),
        sourceType: parent.source_type,
        dueDate: dueDate || null,
        handoffToUserId: assigneeId || null,
        handoffNote: assigneeId ? (note.trim() || "請跟進這項子任務。") : null
      });
      requestId.current = null;
      setTitle("");
      setNote("");
      setAssigneeId("");
      onCreated(created.task);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能建立子任務，請重試。");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel p-4 sm:p-5" aria-label="子任務">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-extrabold text-slate-900">拆細任務</h2><p className="muted mt-1 text-sm">需要先拆先按；每項子任務可獨立指派同完成，原任務唔會自動結案。</p></div>
      {canCreate ? <Button type="button" variant="secondary" onClick={() => setOpen((value) => !value)}>{open ? "收起新增" : "新增子任務"}</Button> : null}
    </div>
    {childTasks.length ? <ul className="mt-4 space-y-2">{childTasks.map((child) => <li key={child.id} className="rounded-xl border border-slate-200 bg-white p-3"><Link href={`/tasks/${child.id}`} className="block min-h-11 font-bold text-indigo-800 hover:underline">{child.title}</Link><p className="text-xs text-slate-600">{child.status === "done" ? "已完成" : "待跟進"} · 到期：{formatDate(child.due_date)}</p></li>)}</ul> : <p className="mt-4 text-sm text-slate-600">暫時未有子任務。</p>}
    {open && canCreate ? <form className="mt-4 grid gap-3 rounded-xl bg-indigo-50 p-4" onSubmit={(event) => void createChild(event)}>
      <label><span className="label">子任務名稱</span><input className="field mt-1" value={title} onChange={(event) => { setTitle(event.target.value); requestId.current = null; }} maxLength={250} required placeholder="例如：先找出需要的文件" /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label><span className="label">到期日（可留空）</span><input className="field mt-1" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label><label><span className="label">交俾邊個（可選）</span><select className="field mt-1" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">自己跟進</option>{otherParticipants.map((person) => <option key={person.user_id} value={person.user_id}>{person.display_name}</option>)}</select></label></div>
      {assigneeId ? <label><span className="label">交接說明（可選）</span><input className="field mt-1" value={note} onChange={(event) => setNote(event.target.value)} maxLength={5000} placeholder="對方先做哪一步？" /></label> : null}
      <div><Button type="submit" disabled={busy || !title.trim()}>{busy ? "建立中…" : "建立子任務"}</Button></div>
      {error ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert">{error}</p> : null}
    </form> : null}
  </section>;
}
