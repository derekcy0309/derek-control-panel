"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { formatDate } from "@/lib/date";
import { useControlData } from "@/hooks/useControlData";

export default function CalendarPage() { return <AuthGate><CalendarContent /></AuthGate>; }

function CalendarContent() {
  const { data, loading, error, reload } = useControlData(); const [cursor, setCursor] = useState(() => new Date()); const [adding, setAdding] = useState(false);
  const events = useMemo(() => { if (!data) return []; return [...data.tasks.filter((item) => item.due_date).map((item) => ({ id: item.id, date: item.due_date!, title: item.title, area: item.area || (item.scope === "company" ? "work" : "family"), kind: "任務", privacy: "full" })), ...data.operatingItems.filter((item) => item.due_date).map((item) => ({ id: item.id, date: item.due_date!, title: item.metadata.calendarPrivacy === "busy" && item.owner_id !== data.currentUser.id ? "忙碌" : item.title, area: item.area, kind: item.item_type === "event" ? "日程" : "項目", privacy: String(item.metadata.calendarPrivacy || "full") }))].sort((a, b) => a.date.localeCompare(b.date)); }, [data]);
  if (loading || error || !data) return <LoadingState error={error} />;
  const year = cursor.getFullYear(), month = cursor.getMonth(); const first = new Date(year, month, 1); const last = new Date(year, month + 1, 0); const cells = Array.from({ length: first.getDay() + last.getDate() }, (_, index) => index < first.getDay() ? null : index - first.getDay() + 1);
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`; const monthEvents = events.filter((event) => event.date.startsWith(monthPrefix));
  return <div className="space-y-5"><section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Calendar</p><h1 className="page-title mt-1">日曆</h1><p className="muted mt-2 text-sm leading-6">只顯示你擁有、明確分享、已接受指派或已同意共同管理的日期。</p></div><Button onClick={() => setAdding(true)}><Plus className="h-5 w-5" />新增日程</Button></section>
    <section className="panel overflow-hidden"><header className="flex items-center justify-between border-b border-slate-200 p-4"><button className="icon-button" onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label="上個月"><ChevronLeft className="h-5 w-5" /></button><h2 className="text-lg font-bold">{year} 年 {month + 1} 月</h2><button className="icon-button" onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label="下個月"><ChevronRight className="h-5 w-5" /></button></header><div className="hidden grid-cols-7 border-b border-slate-200 text-center text-xs font-bold text-slate-500 sm:grid">{"日一二三四五六".split("").map((day) => <div key={day} className="py-2">{day}</div>)}</div><div className="hidden grid-cols-7 sm:grid">{cells.map((day, index) => { const date = day ? `${monthPrefix}-${String(day).padStart(2, "0")}` : ""; const dayEvents = monthEvents.filter((event) => event.date === date); return <div key={index} className="min-h-28 border-b border-r border-slate-100 p-2">{day ? <><p className="text-xs font-bold text-slate-500">{day}</p><div className="mt-1 space-y-1">{dayEvents.slice(0, 3).map((event) => <div key={`${event.kind}-${event.id}`} className={`truncate rounded-md px-2 py-1 text-xs font-semibold ${event.area === "work" ? "bg-indigo-50 text-indigo-700" : event.area === "family" ? "bg-blue-50 text-blue-700" : "bg-teal-50 text-teal-700"}`}>{event.title}</div>)}</div></> : null}</div>; })}</div><div className="divide-y divide-slate-100 sm:hidden">{monthEvents.length ? monthEvents.map((event) => <div key={`${event.kind}-${event.id}`} className="flex gap-3 p-4"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-sm font-bold">{event.date.slice(8)}</div><div><p className="font-semibold">{event.title}</p><p className="muted mt-1 text-xs">{formatDate(event.date)} · {event.kind}</p></div></div>) : <p className="p-6 text-center text-sm text-slate-500">本月沒有日程。</p>}</div></section>
    {adding ? <EventModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} /> : null}
  </div>;
}

function EventModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [area, setArea] = useState<"work" | "family" | "personal">("family");
  const [privacy, setPrivacy] = useState("full");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedWithSyncWarning, setSavedWithSyncWarning] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const scheduleStartAt = new Date(`${date}T${startTime}:00+08:00`);
    const scheduleEndAt = new Date(`${date}T${endTime}:00+08:00`);
    if (confirmed && scheduleEndAt <= scheduleStartAt) {
      setMessage("結束時間必須遲過開始時間。");
      return;
    }

    setSaving(true);
    try {
      const result = await controlAction<{
        calendarSync?: { synced: boolean; error?: string } | null;
      }>("create_item", {
        itemType: "event",
        title,
        dueDate: date,
        area,
        sensitive: privacy === "private",
        scheduleStartAt: confirmed ? scheduleStartAt.toISOString() : null,
        scheduleEndAt: confirmed ? scheduleEndAt.toISOString() : null,
        scheduleTimezone: "Asia/Hong_Kong",
        scheduleStatus: confirmed ? "confirmed" : null,
        calendarTarget: confirmed ? area : "none",
        metadata: {
          calendarPrivacy: privacy === "busy" ? "busy" : "full"
        }
      });
      if (confirmed && !result.calendarSync?.synced) {
        setSavedWithSyncWarning(true);
        setMessage(`行程已安全儲存，但 Google Calendar 未同步：${result.calendarSync?.error || "請先到設定連接相應帳戶。"}`);
      } else {
        onSaved();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能儲存日程。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="新增日程" onClose={onClose}>
      <form className="grid gap-4" onSubmit={save}>
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
          <p className="font-bold text-indigo-950">Google Calendar 只收已確認行程</p>
          <p className="mt-1 text-xs leading-5 text-indigo-800">
            普通任務同 AI 今日計劃會繼續只留喺 Derek Control Panel，避免日曆混亂。
          </p>
        </div>

        <label>
          <span className="label">日程名稱</span>
          <input className="field mt-2" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="label">日期</span>
            <input className="field mt-2" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>
          <label>
            <span className="label">範圍</span>
            <select className="field mt-2" value={area} onChange={(event) => setArea(event.target.value as typeof area)}>
              <option value="work">工作 → info@wecarenursing.com.hk</option>
              <option value="family">家庭 → 家庭 Calendar</option>
              <option value="personal">個人 → 個人登入電郵</option>
            </select>
          </label>
        </div>

        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <input className="mt-1 h-5 w-5 accent-indigo-600" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>
            <span className="block font-bold text-slate-900">呢個時間已確認</span>
            <span className="mt-1 block text-xs leading-5 text-slate-600">
              開啟後才會同步到相應 Google Calendar；取消確認會移除已同步事件。
            </span>
          </span>
        </label>

        {confirmed ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="label">開始</span>
              <input className="field mt-2" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
            </label>
            <label>
              <span className="label">結束</span>
              <input className="field mt-2" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required />
            </label>
          </div>
        ) : null}

        <label>
          <span className="label">顯示方式</span>
          <select className="field mt-2" value={privacy} onChange={(event) => setPrivacy(event.target.value)}>
            <option value="private">Google Calendar 隱藏名稱</option>
            <option value="full">按範圍權限顯示完整名稱</option>
            <option value="busy">家庭成員只見「忙碌」</option>
          </select>
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            家庭範圍仍按家庭共享規則處理；呢個設定只控制名稱顯示，唔會把私人／工作 Task 分享出去。
          </span>
        </label>

        {message ? <p className="text-sm font-semibold text-rose-700" role="alert">{message}</p> : null}
        <div className="flex gap-2">
          {savedWithSyncWarning ? (
            <Button type="button" onClick={onSaved}>完成</Button>
          ) : (
            <Button type="submit" disabled={saving}>{saving ? "儲存中…" : confirmed ? "確認並同步" : "儲存為未確認"}</Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        </div>
      </form>
    </Modal>
  );
}
