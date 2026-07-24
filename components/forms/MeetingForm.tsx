"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { scopeOptions } from "@/lib/labels";
import { controlAction } from "@/lib/control-api";
import type { Meeting } from "@/lib/types";
import { todayIso } from "@/lib/date";

export function MeetingForm({
  initialMeeting,
  compact = false,
  onSaved,
  onCancel
}: {
  userId: string;
  initialMeeting?: Meeting | null;
  compact?: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState({
    scope: initialMeeting?.scope ?? "company",
    meeting_name: initialMeeting?.meeting_name ?? "",
    meeting_date: initialMeeting?.meeting_date ?? todayIso(),
    raw_notes: initialMeeting?.raw_notes ?? "",
    summary: initialMeeting?.summary ?? ""
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function update(name: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    const payload = {
      id: initialMeeting?.id,
      scope: form.scope,
      meeting_name: form.meeting_name.trim(),
      meeting_date: form.meeting_date,
      raw_notes: form.raw_notes.trim() || null,
      summary: form.summary.trim() || null
    };

    try {
      await controlAction("save_meeting", payload);
    } catch (caught) {
      setSaving(false);
      setError(caught instanceof Error ? caught.message : "儲存會議紀錄失敗，請稍後再試。");
      return;
    }
    setSaving(false);
    if (!initialMeeting) {
      setForm({ scope: "company", meeting_name: "", meeting_date: todayIso(), raw_notes: "", summary: "" });
    }
    onSaved();
  }

  return (
    <form className="grid gap-4" onSubmit={save}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="label">家庭 / 公司</span>
          <select className="field mt-2" value={form.scope} onChange={(event) => update("scope", event.target.value)}>
            {scopeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">會議日期</span>
          <input className="field mt-2" type="date" value={form.meeting_date} onChange={(event) => update("meeting_date", event.target.value)} />
        </label>
      </div>
      <label>
        <span className="label">會議名稱</span>
        <input className="field mt-2" value={form.meeting_name} onChange={(event) => update("meeting_name", event.target.value)} required />
      </label>
      <label>
        <span className="label">粗略會議內容</span>
        <textarea
          className="field mt-2 min-h-32"
          value={form.raw_notes}
          onChange={(event) => update("raw_notes", event.target.value)}
          placeholder="直接貼上會議重點、承諾事項、客戶要求"
        />
      </label>
      {!compact ? (
        <label>
          <span className="label">手動摘要</span>
          <textarea className="field mt-2 min-h-24" value={form.summary} onChange={(event) => update("summary", event.target.value)} />
        </label>
      ) : null}
      {error ? <p className="rounded-lg bg-red-50 p-3 text-base font-semibold text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "儲存中..." : initialMeeting ? "儲存修改" : "新增會議"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            取消
          </Button>
        ) : null}
      </div>
    </form>
  );
}
