"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { riskOptions, scopeOptions, sourceTypeOptions, taskStatusOptions } from "@/lib/labels";
import { supabase } from "@/lib/supabase";
import type { Task } from "@/lib/types";

type TaskFormState = {
  scope: string;
  source_type: string;
  title: string;
  owner: string;
  due_date: string;
  follow_up_date: string;
  status: string;
  risk: string;
  next_action: string;
  notes: string;
};

const defaultState: TaskFormState = {
  scope: "home",
  source_type: "follow_up",
  title: "",
  owner: "",
  due_date: "",
  follow_up_date: "",
  status: "not_started",
  risk: "low",
  next_action: "",
  notes: ""
};

export function TaskForm({
  userId,
  initialTask,
  preset,
  compact = false,
  onSaved,
  onCancel
}: {
  userId: string;
  initialTask?: Task | null;
  preset?: Partial<TaskFormState>;
  compact?: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<TaskFormState>(() =>
    initialTask
      ? {
          scope: initialTask.scope,
          source_type: initialTask.source_type,
          title: initialTask.title,
          owner: initialTask.owner ?? "",
          due_date: initialTask.due_date ?? "",
          follow_up_date: initialTask.follow_up_date ?? "",
          status: initialTask.status,
          risk: initialTask.risk,
          next_action: initialTask.next_action,
          notes: initialTask.notes ?? ""
        }
      : { ...defaultState, ...preset }
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function update(name: keyof TaskFormState, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!form.next_action.trim()) {
      setError("請把任務拆到第一個 3 分鐘步驟。");
      return;
    }

    if (!supabase) return;
    setSaving(true);

    const payload = {
      user_id: userId,
      scope: form.scope,
      source_type: form.source_type,
      title: form.title.trim(),
      owner: form.owner.trim() || null,
      due_date: form.due_date || null,
      follow_up_date: form.follow_up_date || null,
      status: form.status,
      next_action: form.next_action.trim(),
      risk: form.risk,
      notes: form.notes.trim() || null
    };

    const result = initialTask
      ? await supabase.from("tasks").update(payload).eq("id", initialTask.id)
      : await supabase.from("tasks").insert(payload);

    setSaving(false);
    if (result.error) {
      setError("儲存任務失敗，請稍後再試。");
      return;
    }

    if (!initialTask) setForm(defaultState);
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
          <span className="label">類型</span>
          <select className="field mt-2" value={form.source_type} onChange={(event) => update("source_type", event.target.value)}>
            {sourceTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        <span className="label">任務標題</span>
        <input className="field mt-2" value={form.title} onChange={(event) => update("title", event.target.value)} required />
      </label>
      <label>
        <span className="label">下一步</span>
        <input
          className="field mt-2"
          value={form.next_action}
          onChange={(event) => update("next_action", event.target.value)}
          placeholder="例如：打開文件，寫第一句摘要"
          required
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="label">到期日</span>
          <input className="field mt-2" type="date" value={form.due_date} onChange={(event) => update("due_date", event.target.value)} />
        </label>
        <label>
          <span className="label">跟進日</span>
          <input
            className="field mt-2"
            type="date"
            value={form.follow_up_date}
            onChange={(event) => update("follow_up_date", event.target.value)}
          />
        </label>
      </div>
      {!compact ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <label>
              <span className="label">負責人</span>
              <input className="field mt-2" value={form.owner} onChange={(event) => update("owner", event.target.value)} />
            </label>
            <label>
              <span className="label">狀態</span>
              <select className="field mt-2" value={form.status} onChange={(event) => update("status", event.target.value)}>
                {taskStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">風險</span>
              <select className="field mt-2" value={form.risk} onChange={(event) => update("risk", event.target.value)}>
                {riskOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <span className="label">備註</span>
            <textarea className="field mt-2 min-h-28" value={form.notes} onChange={(event) => update("notes", event.target.value)} />
          </label>
        </>
      ) : null}
      {error ? <p className="rounded-lg bg-red-50 p-3 text-base font-semibold text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "儲存中..." : initialTask ? "儲存修改" : "新增任務"}
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
