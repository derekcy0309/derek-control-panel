"use client";

import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TimeEstimateHint } from "@/components/TimeEstimateHint";
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
  actual_minutes: string;
  energy_level: string;
  context: string;
  definition_of_done: string;
  estimated_duration_days: string;
  buffer_days: string;
  critical_path: boolean;
  project_id: string;
  handoff_to_user_id: string;
  handoff_note: string;
  recurrence_enabled: boolean;
  recurrence_frequency: string;
  recurrence_weekdays: number[];
  recurrence_custom_interval_days: string;
  recurrence_business_days_only: boolean;
  recurrence_night_shift_pattern: boolean;
  recurrence_night_shift_on_days: string;
  recurrence_night_shift_off_days: string;
  recurrence_cycle_anchor_date: string;
  notice_user_ids: string[];
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
  actual_minutes: "",
  energy_level: "medium",
  context: "computer",
  definition_of_done: "",
  estimated_duration_days: "",
  buffer_days: "0",
  critical_path: false,
  project_id: "",
  handoff_to_user_id: "",
  handoff_note: "",
  recurrence_enabled: false,
  recurrence_frequency: "weekly",
  recurrence_weekdays: [],
  recurrence_custom_interval_days: "7",
  recurrence_business_days_only: false,
  recurrence_night_shift_pattern: false,
  recurrence_night_shift_on_days: "4",
  recurrence_night_shift_off_days: "2",
  recurrence_cycle_anchor_date: "",
  notice_user_ids: []
};

export function TaskForm({
  userId,
  initialTask,
  initialNoticeUserIds = [],
  preset,
  participants = [],
  projects = [],
  compact = false,
  onSaved,
  onCancel
}: {
  userId: string;
  initialTask?: Task | null;
  initialNoticeUserIds?: string[];
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
          actual_minutes: String(initialTask.actual_minutes ?? ""),
          energy_level: initialTask.energy_level ?? "medium",
          context: initialTask.context ?? "computer",
          definition_of_done: initialTask.definition_of_done ?? "",
          estimated_duration_days: String(initialTask.estimated_duration_days ?? ""),
          buffer_days: String(initialTask.buffer_days ?? 0),
          critical_path: initialTask.critical_path ?? false,
          project_id: initialTask.project_id ?? "",
          handoff_to_user_id: "",
          handoff_note: "",
          recurrence_enabled: false,
          recurrence_frequency: "weekly",
          recurrence_weekdays: [],
          recurrence_custom_interval_days: "7",
          recurrence_business_days_only: false,
          recurrence_night_shift_pattern: false,
          recurrence_night_shift_on_days: "4",
          recurrence_night_shift_off_days: "2",
          recurrence_cycle_anchor_date: "",
          notice_user_ids: initialNoticeUserIds
        }
      : { ...defaultState, ...(preset?.scope === "company" ? { area: "work" } : {}), ...preset }
  );
  const [handoffOpen, setHandoffOpen] = useState(Boolean(form.handoff_to_user_id));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);
  const [recurrenceWarning, setRecurrenceWarning] = useState("");
  const otherParticipants = participants.filter((participant) => participant.user_id !== userId);

  function update(name: keyof TaskFormState, value: string | boolean) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function toggleRecurrenceWeekday(day: number) {
    setForm((current) => ({
      ...current,
      recurrence_weekdays: current.recurrence_weekdays.includes(day)
        ? current.recurrence_weekdays.filter((value) => value !== day)
        : [...current.recurrence_weekdays, day].sort((left, right) => left - right)
    }));
  }

  function toggleNoticeRecipient(userId: string) {
    setForm((current) => ({
      ...current,
      notice_user_ids: current.notice_user_ids.includes(userId)
        ? current.notice_user_ids.filter((id) => id !== userId)
        : [...current.notice_user_ids, userId]
    }));
  }

  function recurrencePayload(taskId: string) {
    return {
      taskId,
      frequency: form.recurrence_frequency,
      weekdays: form.recurrence_weekdays,
      customIntervalDays: Number(form.recurrence_custom_interval_days),
      businessDaysOnly: form.recurrence_business_days_only,
      nightShiftPattern: form.recurrence_night_shift_pattern,
      nightShiftOnDays: Number(form.recurrence_night_shift_on_days),
      nightShiftOffDays: Number(form.recurrence_night_shift_off_days),
      cycleAnchorDate: form.recurrence_cycle_anchor_date || null
    };
  }

  async function retryRecurrence() {
    if (!createdTaskId) return;
    setSaving(true);
    setError("");
    try {
      await controlAction("save_task_recurrence", recurrencePayload(createdTaskId));
      setRecurrenceWarning("");
      onSaved();
    } catch (caught) {
      setRecurrenceWarning(caught instanceof Error ? caught.message : "未能設定重複工作，任務仍然安全保留。");
    } finally {
      setSaving(false);
    }
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
      actualMinutes: form.actual_minutes ? Number(form.actual_minutes) : null,
      energyLevel: form.energy_level,
      context: form.context,
      definitionOfDone: form.definition_of_done.trim() || null,
      estimatedDurationDays: form.estimated_duration_days ? Number(form.estimated_duration_days) : null,
      bufferDays: Number(form.buffer_days || 0),
      criticalPath: form.critical_path,
      projectId: form.project_id || null,
      handoffToUserId: form.handoff_to_user_id || null,
      handoffNote: form.handoff_note.trim() || null,
      noticeUserIds: form.notice_user_ids
    };
    try {
      if (initialTask) {
        await controlAction("update_task", { id: initialTask.id, noticeUserIds: payload.noticeUserIds, changes: {
          title: payload.title, status: payload.status, next_action: payload.nextAction, due_date: payload.dueDate, follow_up_date: payload.followUpDate,
          risk: payload.risk, notes: payload.notes, completed_at: payload.completedAt,
          estimated_minutes: payload.estimatedMinutes, actual_minutes: payload.actualMinutes, energy_level: payload.energyLevel, context: payload.context,
          definition_of_done: payload.definitionOfDone, estimated_duration_days: payload.estimatedDurationDays,
          buffer_days: payload.bufferDays, critical_path: payload.criticalPath, project_id: payload.projectId
        } });
      } else {
        const created = await controlAction<{ task: Task }>("create_task", payload);
        if (form.recurrence_enabled) {
          try {
            await controlAction("save_task_recurrence", recurrencePayload(created.task.id));
          } catch (caught) {
            setCreatedTaskId(created.task.id);
            setRecurrenceWarning(caught instanceof Error ? caught.message : "任務已建立，但未能設定重複工作。");
            setSaving(false);
            return;
          }
        }
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
      {createdTaskId ? (
        <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4" aria-live="polite">
          <p className="font-extrabold text-amber-950">任務已建立，但重複工作尚未設定。</p>
          <p className="mt-1 text-sm leading-6 text-amber-900">{recurrenceWarning || "任務沒有遺失；你可以重試，或先返回任務列表。"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void retryRecurrence()} disabled={saving}>{saving ? "設定中…" : "重試設定重複工作"}</Button>
            <Button type="button" variant="secondary" onClick={onSaved}>先查看任務</Button>
          </div>
        </section>
      ) : null}
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
      {otherParticipants.length ? (
        <fieldset className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <legend className="px-1 font-extrabold text-slate-900">俾邊個知道呢項任務？</legend>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            只會讓你勾選的人看到任務及收到私隱安全通知；未勾選就不會因這個設定分享。
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {otherParticipants.map((participant) => (
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 font-semibold text-slate-800" key={participant.user_id}>
                <input
                  className="h-5 w-5 accent-indigo-600"
                  type="checkbox"
                  checked={form.notice_user_ids.includes(participant.user_id)}
                  onChange={() => toggleNoticeRecipient(participant.user_id)}
                />
                通知 {participant.display_name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <label>
        <span className="label">任務標題</span>
        <input className="field mt-2" value={form.title} onChange={(event) => update("title", event.target.value)} required />
      </label>
      {!initialTask ? (
        <fieldset className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              className="mt-1 h-5 w-5 accent-indigo-600"
              type="checkbox"
              checked={form.recurrence_enabled}
              onChange={(event) => update("recurrence_enabled", event.target.checked)}
            />
            <span>
              <span className="block font-extrabold text-slate-900">這是一項重複工作</span>
              <span className="mt-1 block text-sm leading-6 text-slate-600">完成目前這一項後才建立下一項，不會預先產生大量 backlog。之後可在任務卡暫停或恢復。</span>
            </span>
          </label>
          {form.recurrence_enabled ? (
            <div className="mt-4 grid gap-4">
              <label>
                <span className="label">重複方式</span>
                <select className="field mt-2 bg-white" value={form.recurrence_frequency} onChange={(event) => update("recurrence_frequency", event.target.value)}>
                  <option value="daily">每日</option>
                  <option value="weekly">每星期指定日</option>
                  <option value="monthly">每月同一日</option>
                  <option value="custom">自訂相隔日數</option>
                </select>
              </label>
              {form.recurrence_frequency === "weekly" ? (
                <div>
                  <p className="label">每星期哪一天</p>
                  <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
                    {[
                      [0, "日"], [1, "一"], [2, "二"], [3, "三"], [4, "四"], [5, "五"], [6, "六"]
                    ].map(([day, label]) => {
                      const value = Number(day);
                      const checked = form.recurrence_weekdays.includes(value);
                      return (
                        <label className={`cursor-pointer rounded-lg border-2 px-3 py-2 text-center text-sm font-bold ${checked ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-700"}`} key={value}>
                          <input className="sr-only" type="checkbox" checked={checked} onChange={() => toggleRecurrenceWeekday(value)} />
                          星期{label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {form.recurrence_frequency === "custom" ? (
                <label>
                  <span className="label">每隔幾日</span>
                  <input className="field mt-2 bg-white" type="number" min="1" max="3650" value={form.recurrence_custom_interval_days} onChange={(event) => update("recurrence_custom_interval_days", event.target.value)} />
                </label>
              ) : null}
              <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                <input className="h-5 w-5 accent-indigo-600" type="checkbox" checked={form.recurrence_business_days_only} onChange={(event) => update("recurrence_business_days_only", event.target.checked)} />
                只在工作日產生下一項
              </label>
              <label className="flex items-start gap-3 rounded-xl bg-white p-3 text-sm text-slate-700">
                <input className="mt-1 h-5 w-5 accent-indigo-600" type="checkbox" checked={form.recurrence_night_shift_pattern} onChange={(event) => update("recurrence_night_shift_pattern", event.target.checked)} />
                <span><span className="block font-bold">按夜更週期</span><span className="mt-1 block leading-5">開啟後會以「工作幾日／休息幾日」取代上方日期規則。</span></span>
              </label>
              {form.recurrence_night_shift_pattern ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <label><span className="label">工作日數</span><input className="field mt-2 bg-white" type="number" min="1" max="365" value={form.recurrence_night_shift_on_days} onChange={(event) => update("recurrence_night_shift_on_days", event.target.value)} /></label>
                  <label><span className="label">休息日數</span><input className="field mt-2 bg-white" type="number" min="0" max="365" value={form.recurrence_night_shift_off_days} onChange={(event) => update("recurrence_night_shift_off_days", event.target.value)} /></label>
                  <label><span className="label">週期第一日（可選）</span><input className="field mt-2 bg-white" type="date" value={form.recurrence_cycle_anchor_date} onChange={(event) => update("recurrence_cycle_anchor_date", event.target.value)} /></label>
                </div>
              ) : null}
            </div>
          ) : null}
        </fieldset>
      ) : null}
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
        <details
          className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
          open={handoffOpen}
          onToggle={(event) => setHandoffOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer list-none font-extrabold text-slate-900">
            <span className="inline-flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-indigo-600" />
              建立後由誰跟進（可選）
            </span>
            <span className="mt-1 block text-xs font-medium leading-5 text-slate-600">
              預設由你自己跟進；只有真正要交接先需要打開。
            </span>
          </summary>
          <div className="mt-4">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-indigo-600 p-2 text-white" aria-hidden="true">
              <ArrowRightLeft className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-extrabold text-slate-900">由誰跟進？</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">保持「我」就唔會分享；選另一位先會正式交接。</p>
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
          </div>
        </details>
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
      <div className={`grid gap-4 ${initialTask ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        <label><span className="label">預計時間（分鐘）</span><input className="field mt-2" type="number" min="1" value={form.estimated_minutes} onChange={(event) => update("estimated_minutes", event.target.value)} /></label>
        {initialTask ? <label><span className="label">實際時間（分鐘）</span><input className="field mt-2" type="number" min="1" value={form.actual_minutes} onChange={(event) => update("actual_minutes", event.target.value)} /><span className="mt-1 block text-xs text-slate-500">只用於你自己的估時學習</span></label> : null}
        <label><span className="label">能量</span><select className="field mt-2" value={form.energy_level} onChange={(event) => update("energy_level", event.target.value)}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
        <label><span className="label">情境</span><select className="field mt-2" value={form.context} onChange={(event) => update("context", event.target.value)}><option value="mobile">手機</option><option value="computer">電腦</option><option value="home">家中</option><option value="office">辦公室</option><option value="phone">電話</option><option value="night_shift">夜更可做</option></select></label>
      </div>
      <TimeEstimateHint sourceType={form.source_type} context={form.context} energyLevel={form.energy_level} estimatedMinutes={form.estimated_minutes} onUse={(minutes) => update("estimated_minutes", String(minutes))} />
      {!compact ? (
        <details className="rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer font-extrabold text-slate-900">
            更多選項
            <span className="ml-2 text-xs font-medium text-slate-500">風險、備註、完成定義、工期同關鍵路徑</span>
          </summary>
          <div className="mt-4 grid gap-4">
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
          </div>
        </details>
      ) : null}
      {error ? <p className="rounded-lg bg-red-50 p-3 text-base font-semibold text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={saving || Boolean(createdTaskId)}>
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
