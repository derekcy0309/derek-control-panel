"use client";

import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { riskOptions, sourceTypeOptions, taskStatusOptions } from "@/lib/labels";
import { controlAction } from "@/lib/control-api";
import type { OperatingItem, Task } from "@/lib/types";

type TaskFormState = {
  scope: string;
  area: string;
  source_type: string;
  title: string;
  owner: string;
  due_date: string;
  follow_up_date: string;
  status: string;
  risk: string;
  next_action: string;
  notes: string;
  estimated_minutes: string;
  energy_level: string;
  context: string;
  definition_of_done: string;
  estimated_duration_days: string;
  buffer_days: string;
  critical_path: boolean;
  project_id: string;
  handoff_to_user_id: string;
  handoff_note: string;
};

const defaultState: TaskFormState = {
  scope: "home",
  area: "personal",
  source_type: "follow_up",
  title: "",
  owner: "",
  due_date: "",
  follow_up_date: "",
  status: "not_started",
  risk: "low",
  next_action: "",
  notes: "",
  estimated_minutes: "",
  energy_level: "medium",
  context: "computer",
  definition_of_done: "",
  estimated_duration_days: "",
  buffer_days: "0",
  critical_path: false,
  project_id: "",
  handoff_to_user_id: "",
  handoff_note: ""
};

export function TaskForm({
  userId,
  initialTask,
  preset,
  participants = [],
  projects = [],
  compact = false,
  onSaved,
  onCancel
}: {
  userId: string;
  initialTask?: Task | null;
  preset?: Partial<TaskFormState>;
  participants?: Array<{ user_id: string; display_name: string }>;
  projects?: OperatingItem[];
  compact?: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<TaskFormState>(() =>
    initialTask
      ? {
          scope: initialTask.scope,
          area: initialTask.area ?? (initialTask.scope === "company" ? "work" : "family"),
          source_type: initialTask.source_type,
          title: initialTask.title,
          owner: initialTask.owner ?? "",
          due_date: initialTask.due_date ?? "",
          follow_up_date: initialTask.follow_up_date ?? "",
          status: initialTask.status === "done" || initialTask.status === "cancelled" ? initialTask.status : "not_started",
          risk: initialTask.risk,
          next_action: initialTask.next_action ?? "",
          notes: initialTask.notes ?? "",
          estimated_minutes: String(initialTask.estimated_minutes ?? ""),
          energy_level: initialTask.energy_level ?? "medium",
          context: initialTask.context ?? "computer",
          definition_of_done: initialTask.definition_of_done ?? "",
          estimated_duration_days: String(initialTask.estimated_duration_days ?? ""),
          buffer_days: String(initialTask.buffer_days ?? 0),
          critical_path: initialTask.critical_path ?? false,
          project_id: initialTask.project_id ?? "",
          handoff_to_user_id: "",
          handoff_note: ""
        }
      : { ...defaultState, ...(preset?.scope === "company" ? { area: "work" } : {}), ...preset }
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const otherParticipants = participants.filter((participant) => participant.user_id !== userId);

  function update(name: keyof TaskFormState, value: string | boolean) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!initialTask && form.handoff_to_user_id && !form.handoff_note.trim()) {
      setError("請填交接 notes，讓對方知道第一步要做甚麼。");
      return;
    }

    setSaving(true);

    const completedAt =
      form.status === "done" ? initialTask?.completed_at ?? new Date().toISOString() : null;

    const payload = {
      area: form.area,
      sourceType: form.source_type,
      title: form.title.trim(),
      dueDate: form.due_date || null,
      followUpDate: form.follow_up_date || null,
      status: form.status,
      nextAction: form.next_action.trim() || null,
      risk: form.risk,
      notes: form.notes.trim() || null,
      owner: form.owner.trim() || null,
      completedAt,
      estimatedMinutes: form.estimated_minutes ? Number(form.estimated_minutes) : null,
      energyLevel: form.energy_level,
      context: form.context,
      definitionOfDone: form.definition_of_done.trim() || null,
      estimatedDurationDays: form.estimated_duration_days ? Number(form.estimated_duration_days) : null,
      bufferDays: Number(form.buffer_days || 0),
      criticalPath: form.critical_path,
      projectId: form.project_id || null,
      handoffToUserId: form.handoff_to_user_id || null,
      handoffNote: form.handoff_note.trim() || null
    };
    try {
      if (initialTask) {
        await controlAction("update_task", { id: initialTask.id, changes: {
          title: payload.title, status: payload.status, next_action: payload.nextAction, due_date: payload.dueDate, follow_up_date: payload.followUpDate,
          risk: payload.risk, notes: payload.notes, completed_at: payload.completedAt,
          estimated_minutes: payload.estimatedMinutes, energy_level: payload.energyLevel, context: payload.context,
          definition_of_done: payload.definitionOfDone, estimated_duration_days: payload.estimatedDurationDays,
          buffer_days: payload.bufferDays, critical_path: payload.criticalPath, project_id: payload.projectId
        } });
      } else {
        await controlAction("create_task", payload);
      }
    } catch (caught) {
      setSaving(false);
      setError(caught instanceof Error ? caught.message : "儲存任務失敗，請稍後再試。");
      return;
    }
    setSaving(false);
    if (!initialTask) setForm(defaultState);
    onSaved();
  }

  return (
    <form className="grid gap-4" onSubmit={save}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="label">範圍</span>
          <select className="field mt-2" value={form.area} onChange={(event) => update("area", event.target.value)}>
            <option value="work">工作</option><option value="family">家庭</option><option value="personal">個人</option>
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
      {projects.length ? (
        <label>
          <span className="label">所屬項目（可選）</span>
          <select className="field mt-2" value={form.project_id} onChange={(event) => update("project_id", event.target.value)}>
            <option value="">不連結項目</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
          <span className="mt-1 block text-xs text-slate-600">連結只用作規劃；不會自動分享任務或改變現有權限。</span>
        </label>
      ) : null}
      <label>
        <span className="label">下一步</span>
        <input
          className="field mt-2"
          value={form.next_action}
          onChange={(event) => update("next_action", event.target.value)}
          placeholder="可選填，例如：打開文件，寫第一句摘要"
        />
      </label>
      {!initialTask ? (
        <fieldset className="rounded-2xl border-2 border-indigo-300 bg-indigo-50/70 p-4 shadow-sm">
          <legend className="px-2 text-sm font-extrabold uppercase tracking-wide text-indigo-700">
            必須選擇
          </legend>
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-indigo-600 p-2 text-white" aria-hidden="true">
              <ArrowRightLeft className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-extrabold text-slate-900">建立後由誰跟進？</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">新增前直接揀「我」或「Suki」，之後仍可在任務卡隨時轉交。</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 bg-white p-4 ${
                  !form.handoff_to_user_id ? "border-indigo-600 ring-2 ring-indigo-100" : "border-slate-200"
                }`}>
                  <input
                    className="mt-1 h-5 w-5 accent-indigo-600"
                    type="radio"
                    name="new-task-handler"
                    value=""
                    checked={!form.handoff_to_user_id}
                    onChange={() => update("handoff_to_user_id", "")}
                  />
                  <span>
                    <span className="block font-extrabold text-slate-900">由我跟進</span>
                    <span className="mt-1 block text-sm text-slate-600">任務留給目前登入的我。</span>
                  </span>
                </label>
                {otherParticipants.map((participant) => (
                  <label
                    key={participant.user_id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 bg-white p-4 ${
                      form.handoff_to_user_id === participant.user_id
                        ? "border-indigo-600 ring-2 ring-indigo-100"
                        : "border-slate-200"
                    }`}
                  >
                    <input
                      className="mt-1 h-5 w-5 accent-indigo-600"
                      type="radio"
                      name="new-task-handler"
                      value={participant.user_id}
                      checked={form.handoff_to_user_id === participant.user_id}
                      onChange={() => update("handoff_to_user_id", participant.user_id)}
                    />
                    <span>
                      <span className="block font-extrabold text-slate-900">由 {participant.display_name} 跟進</span>
                      <span className="mt-1 block text-sm text-slate-600">建立後立即交給對方接手。</span>
                    </span>
                  </label>
                ))}
                {!otherParticipants.length ? (
                  <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 p-4 sm:col-span-2">
                    <p className="font-bold text-amber-900">Suki 選項暫時未能載入</p>
                    <p className="mt-1 text-sm leading-6 text-amber-800">可先重新整理頁面；系統不會再把這個問題靜默隱藏。</p>
                  </div>
                ) : null}
              </div>
              {form.handoff_to_user_id ? (
                <label className="mt-4 block">
                  <span className="label">交接 notes</span>
                  <textarea
                    className="field mt-2 min-h-24 bg-white"
                    value={form.handoff_note}
                    onChange={(event) => update("handoff_note", event.target.value)}
                    placeholder="例如：請先致電確認，再在 notes 更新結果。"
                    maxLength={500}
                    required
                  />
                  <span className="mt-1 block text-xs leading-5 text-slate-600">
                    建立任務後會立即送俾對方接受；雙方都會永久看到這段 notes。
                  </span>
                </label>
              ) : null}
            </div>
          </div>
        </fieldset>
      ) : null}
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
      <div className="grid gap-4 sm:grid-cols-3">
        <label><span className="label">預計時間（分鐘）</span><input className="field mt-2" type="number" min="1" value={form.estimated_minutes} onChange={(event) => update("estimated_minutes", event.target.value)} /></label>
        <label><span className="label">能量</span><select className="field mt-2" value={form.energy_level} onChange={(event) => update("energy_level", event.target.value)}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
        <label><span className="label">情境</span><select className="field mt-2" value={form.context} onChange={(event) => update("context", event.target.value)}><option value="mobile">手機</option><option value="computer">電腦</option><option value="home">家中</option><option value="office">辦公室</option><option value="phone">電話</option><option value="night_shift">夜更可做</option></select></label>
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
          <label><span className="label">完成定義</span><input className="field mt-2" value={form.definition_of_done} onChange={(event) => update("definition_of_done", event.target.value)} placeholder="怎樣才算真正完成？" /></label>
          <div className="grid gap-4 sm:grid-cols-2"><label><span className="label">預計工期（日）</span><input className="field mt-2" type="number" min="0" value={form.estimated_duration_days} onChange={(event) => update("estimated_duration_days", event.target.value)} /></label><label><span className="label">緩衝（日）</span><input className="field mt-2" type="number" min="0" value={form.buffer_days} onChange={(event) => update("buffer_days", event.target.value)} /></label></div>
          <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 ${form.critical_path ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
            <input
              className="mt-1 h-5 w-5 shrink-0 accent-amber-600"
              type="checkbox"
              checked={form.critical_path}
              onChange={(event) => update("critical_path", event.target.checked)}
            />
            <span>
              <span className="block font-bold text-slate-900">這項任務會卡住後續工作</span>
              <span className="mt-1 block text-sm leading-6 text-slate-600">
                即「關鍵路徑」：只有遲咗會令整個項目或死線一齊延遲先剔。系統會把它排得更優先；一般任務不用剔。
              </span>
              <span className="mt-1 block text-sm font-semibold text-amber-800">
                例：必須先簽好合約，其他人先可以正式開工。
              </span>
            </span>
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
