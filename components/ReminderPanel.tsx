"use client";

import { useState } from "react";
import { BellRing, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import type { Reminder } from "@/lib/types";

function localInput(date = new Date(Date.now() + 3_600_000)) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function ReminderPanel({
  reminders,
  participants,
  currentUserId,
  onChanged
}: {
  reminders: Reminder[];
  participants: Array<{ user_id: string; display_name: string }>;
  currentUserId: string;
  onChanged: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState(localInput());
  const [remindAt, setRemindAt] = useState(localInput(new Date(Date.now() + 1_800_000)));
  const [notes, setNotes] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const others = participants.filter((participant) => participant.user_id !== currentUserId);
  const names = new Map(participants.map((participant) => [participant.user_id, participant.display_name]));

  function toggleRecipient(id: string) {
    setRecipients((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await controlAction("save_reminder", {
        title, notes, startsAt: new Date(startsAt).toISOString(),
        remindAt: new Date(remindAt).toISOString(), recipientUserIds: recipients
      });
      setTitle(""); setNotes(""); setRecipients([]); setOpen(false);
      await onChanged();
      setMessage("提醒／活動已加入，已選對象會在指定時間收到通知。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能儲存提醒。");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("刪除這個提醒／活動？已排程通知亦會取消。")) return;
    setBusy(true);
    try {
      await controlAction("delete_reminder", { id });
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能刪除提醒。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3"><span className="rounded-xl bg-amber-50 p-2 text-amber-700"><BellRing className="h-5 w-5" /></span><div><h2 className="font-extrabold text-slate-900">提醒／活動</h2><p className="mt-1 text-sm leading-6 text-slate-600">學校活動、約會或重要日子都可以；唔需要建立成任務。</p></div></div>
        <Button type="button" variant="secondary" onClick={() => setOpen((value) => !value)}>{open ? "收起" : "新增提醒"}</Button>
      </div>
      {open ? (
        <form className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4" onSubmit={save}>
          <label><span className="label">活動／提醒名稱</span><input className="field mt-2 bg-white" value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="例如：學校旅行集合" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className="label">活動時間</span><input className="field mt-2 bg-white" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label>
            <label><span className="label">幾時提醒</span><input className="field mt-2 bg-white" type="datetime-local" value={remindAt} onChange={(event) => setRemindAt(event.target.value)} required /></label>
          </div>
          <label><span className="label">備註（可選）</span><textarea className="field mt-2 min-h-20 bg-white" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          {others.length ? <fieldset><legend className="label">同時通知</legend><div className="mt-2 flex flex-wrap gap-2">{others.map((participant) => <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold" key={participant.user_id}><input className="h-5 w-5 accent-indigo-600" type="checkbox" checked={recipients.includes(participant.user_id)} onChange={() => toggleRecipient(participant.user_id)} />通知 {participant.display_name}</label>)}</div></fieldset> : null}
          <Button disabled={busy}>{busy ? "儲存中…" : "儲存提醒"}</Button>
        </form>
      ) : null}
      <div className="mt-4 space-y-2">
        {reminders.map((reminder) => (
          <article className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3" key={reminder.id}>
            <div><p className="font-bold text-slate-900">{reminder.title}</p><p className="mt-1 text-sm text-slate-600">{new Date(reminder.starts_at).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", dateStyle: "medium", timeStyle: "short" })}</p>{reminder.recipient_user_ids.length ? <p className="mt-1 text-xs text-slate-500">通知：{reminder.recipient_user_ids.map((id) => names.get(id) ?? "Portal 用戶").join("、")}</p> : null}</div>
            {reminder.owner_id === currentUserId ? <button className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700" type="button" disabled={busy} onClick={() => void remove(reminder.id)} aria-label={`刪除 ${reminder.title}`}><Trash2 className="h-4 w-4" /></button> : null}
          </article>
        ))}
        {!reminders.length ? <p className="py-3 text-sm text-slate-500">暫時未有即將發生的提醒或活動。</p> : null}
      </div>
      {message ? <p className="mt-3 text-sm font-semibold text-slate-600" role="status">{message}</p> : null}
    </section>
  );
}
