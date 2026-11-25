"use client";

import { useEffect, useId, useState } from "react";
import { DueDatePicker } from "@/components/forms/DueDatePicker";
import { TaskWorkDaysPicker } from "@/components/forms/TaskWorkDaysPicker";
import { Button } from "@/components/ui/Button";
import { useDaylineDate } from "@/hooks/useDaylineDate";
import { controlAction } from "@/lib/control-api";
import { taskStatusOptions } from "@/lib/labels";
import { addRoutineInterval, formatRoutineDate, nextRoutineWeeklyDate, routineWeekdays, type RoutineIntervalUnit } from "@/lib/routine-interval";
import { TaskTagPicker } from "@/components/tasks/TaskTagPicker";
import { priorityFromTaskTags, taskTagPriorityChange } from "@/lib/task-tag-ui";
import { parseTaskPriorityGrade, priorityDefaultDeadline, taskPriorityGrade, taskPriorityGrades, type TaskPriorityGrade } from "@/lib/task-priority-grade";
import { validateTaskWorkSchedule } from "@/lib/task-work-schedule";
import type { PersonalTaskTag, Task } from "@/lib/types";

export type TaskSaveResult = { task: Task; refreshRelated: boolean };

type TaskFormState = {
  scope: string;
  area: string;
  tag_ids: string[];
  client_request_id: string;
  source_type: string;
  title: string;
  add_to_today: boolean;
  owner: string;
  due_date: string;
  priority_grade: TaskPriorityGrade | null;
  priority_deadline_mode: "auto" | "manual";
  work_start_date: string;
  work_dates: string[];
  follow_up_date: string;
  waiting_for: string;
  waiting_on: string;
  status: string;
  custom_status_label: string;
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
  recurrence_mode: "interval" | "weekly";
  recurrence_interval_value: string;
  recurrence_interval_unit: RoutineIntervalUnit;
  recurrence_weekdays: number[];
  recurrence_end_mode: "never" | "date";
  recurrence_ends_on: string;
  notice_user_ids: string[];
  follower_user_ids: string[];
};

const defaultState: TaskFormState = {
  scope: "home",
  area: "personal",
  tag_ids: [],
  client_request_id: "",
  source_type: "follow_up",
  title: "",
  add_to_today: false,
  owner: "",
  due_date: "",
  priority_grade: null,
  priority_deadline_mode: "auto",
  work_start_date: "",
  work_dates: [],
  follow_up_date: "",
  waiting_for: "",
  waiting_on: "",
  status: "not_started",
  custom_status_label: "",
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
  recurrence_mode: "interval",
  recurrence_interval_value: "1",
  recurrence_interval_unit: "month",
  recurrence_weekdays: [],
  recurrence_end_mode: "never",
  recurrence_ends_on: "",
  notice_user_ids: [],
  follower_user_ids: []
};

export function TaskForm({
  userId,
  initialTask,
  initialNoticeUserIds = [],
  initialFollowerUserIds = [],
  preset,
  participants = [],
  compact = false,
  inline = false,
  knownTags,
  statusSuggestions = [],
  onSaved,
  onCancel
}: {
  userId: string;
  initialTask?: Task | null;
  initialNoticeUserIds?: string[];
  initialFollowerUserIds?: string[];
  preset?: Partial<TaskFormState>;
  participants?: Array<{ user_id: string; display_name: string }>;
  compact?: boolean;
  inline?: boolean;
  knownTags?: PersonalTaskTag[];
  statusSuggestions?: string[];
  onSaved: (result?: TaskSaveResult) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<TaskFormState>(() =>
    initialTask
      ? {
          scope: initialTask.scope,
          area: initialTask.area ?? (initialTask.scope === "company" ? "work" : "family"),
          tag_ids: initialTask.personal_tag_ids ?? [],
          client_request_id: initialTask.client_request_id ?? "",
          source_type: initialTask.source_type,
          title: initialTask.title,
          add_to_today: false,
          owner: initialTask.owner ?? "",
          due_date: initialTask.due_date ?? "",
          // null means the user has not explicitly changed the displayed grade.
          priority_grade: null,
          priority_deadline_mode: "manual",
          work_start_date: initialTask.work_start_date ?? "",
          work_dates: initialTask.work_dates ?? [],
          follow_up_date: initialTask.follow_up_date ?? "",
          waiting_for: initialTask.waiting_for ?? "",
          waiting_on: initialTask.waiting_on ?? "",
          status: initialTask.status,
          custom_status_label: initialTask.custom_status_label ?? "",
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
          recurrence_mode: "interval",
          recurrence_interval_value: "1",
          recurrence_interval_unit: "month",
          recurrence_weekdays: [],
          recurrence_end_mode: "never",
          recurrence_ends_on: "",
          notice_user_ids: initialNoticeUserIds,
          follower_user_ids: initialFollowerUserIds
        }
      : { ...defaultState, ...(preset?.scope === "company" ? { area: "work" } : {}), ...preset, priority_deadline_mode: preset?.priority_deadline_mode ?? (preset?.due_date ? "manual" : "auto"), client_request_id: crypto.randomUUID() }
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);
  const [recurrenceWarning, setRecurrenceWarning] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [catalog,setCatalog] = useState<PersonalTaskTag[]>(knownTags ?? []);
  const [catalogRead, setCatalogRead] = useState(Boolean(knownTags?.length));
  const [baselineTags, setBaselineTags] = useState(initialTask?.personal_tag_ids ?? []);
  const [tagsTouched, setTagsTouched] = useState(false);
  const [optionsOpen,setOptionsOpen] = useState(Boolean(initialTask || preset?.status === "waiting"));
  const customStatusListId = useId();
  const priorityPickerId = useId();
  const priorityHintId = `${priorityPickerId}-hint`;
  const today = useDaylineDate();
  const initialPriority = initialTask ? taskPriorityGrade(initialTask, catalog, today) : null;
  const gradeChanged = initialTask && form.priority_grade !== null && form.priority_grade !== initialPriority;
  const selectedPriority = form.priority_grade ?? initialPriority;
  const autoDeadline = !initialTask && selectedPriority !== null && form.priority_deadline_mode === "auto";
  const dueDate = autoDeadline ? priorityDefaultDeadline(today, selectedPriority) : form.due_date;
  const otherParticipants = participants.filter((participant) => participant.user_id !== userId);
  const nextRoutineDueDate = dueDate
    ? form.recurrence_mode === "weekly"
      ? nextRoutineWeeklyDate(dueDate, form.recurrence_weekdays)
      : addRoutineInterval(dueDate, Number(form.recurrence_interval_value), form.recurrence_interval_unit)
    : null;
  const draftKey = `dcp:task-form-draft:v1:${userId}:${preset?.status ?? "new"}`;
  const draftEligible = !initialTask;

  useEffect(() => {
    if (!draftEligible) { setDraftReady(true); return; }
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<TaskFormState>;
        const grade = parseTaskPriorityGrade(parsed.priority_grade);
        const manualDeadline = parsed.priority_deadline_mode === "manual" || (!parsed.priority_deadline_mode && Boolean(parsed.due_date));
        if (parsed.title || parsed.next_action || parsed.notes || parsed.handoff_note || grade || manualDeadline) {
          setForm((current) => ({ ...current, ...parsed, priority_grade: grade, priority_deadline_mode: manualDeadline ? "manual" : "auto" }));
          setDraftRestored(true);
        }
      }
      setForm((current) => ({ ...current, client_request_id: current.client_request_id || crypto.randomUUID() }));
    } catch {
      setDraftError("瀏覽器未能保留草稿，離開前請先儲存 Task。");
    } finally {
      setDraftReady(true);
    }
  }, [draftEligible, draftKey]);

  useEffect(() => {
    if (!draftEligible || !draftReady) return;
    const hasContent = Boolean(form.title.trim() || form.next_action.trim() || form.notes.trim() || form.handoff_note.trim() ||
      form.priority_grade || form.priority_deadline_mode === "manual");
    try {
      if (hasContent) sessionStorage.setItem(draftKey, JSON.stringify(form));
      else sessionStorage.removeItem(draftKey);
      setDraftError("");
    } catch {
      setDraftError("草稿未能自動儲存，離開前請先儲存 Task。");
    }
  }, [draftEligible, draftKey, draftReady, form]);

  function update(name: keyof TaskFormState, value: string | boolean) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function toggleFollower(userId: string) {
    setForm((current) => ({
      ...current,
      follower_user_ids: current.follower_user_ids.includes(userId)
        ? current.follower_user_ids.filter((id) => id !== userId)
        : [...current.follower_user_ids, userId]
    }));
  }

  function toggleNotice(userId: string) {
    setForm((current) => ({
      ...current,
      notice_user_ids: current.notice_user_ids.includes(userId)
        ? current.notice_user_ids.filter((id) => id !== userId)
        : [...current.notice_user_ids, userId]
    }));
  }

  function toggleRecurrenceWeekday(day: number) {
    setForm((current) => ({
      ...current,
      recurrence_weekdays: current.recurrence_weekdays.includes(day)
        ? current.recurrence_weekdays.filter((value) => value !== day)
        : [...current.recurrence_weekdays, day]
    }));
  }

  function recurrencePayload(taskId: string) {
    return {
      taskId,
      deadlineMode: "scheduled",
      frequency: form.recurrence_mode,
      weekdays: form.recurrence_mode === "weekly" ? form.recurrence_weekdays : [],
      intervalValue: form.recurrence_mode === "interval" ? Number(form.recurrence_interval_value) : null,
      intervalUnit: form.recurrence_mode === "interval" ? form.recurrence_interval_unit : null,
      endsOn: form.recurrence_end_mode === "date" ? form.recurrence_ends_on || null : null
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
    if (saving || createdTaskId) return;
    setError("");
    if (!form.title.trim()) { setError("寫低個 Task 名就得。"); return; }
    const workSchedule = validateTaskWorkSchedule({
      startDate: form.work_start_date || form.work_dates[0] || null,
      dueDate: dueDate || null,
      workDates: form.work_start_date || form.work_dates.length ? form.work_dates : null
    });
    if (workSchedule.error) { setError(workSchedule.error); return; }
    if ((form.recurrence_enabled || initialTask?.recurrence_rule_id) && workSchedule.startDate) {
      setError("重複工作請用下方 Routine 設定；個別工作日只適用於一次性任務。");
      return;
    }
    if (form.recurrence_enabled) {
      const intervalValue = Number(form.recurrence_interval_value);
      if (!dueDate) {
        setError("Routine 工作需要先設定首次到期日。");
        return;
      }
      if (form.recurrence_mode === "interval" && (!Number.isInteger(intervalValue) || intervalValue < 1 || intervalValue > 3650)) {
        setError("Routine 相隔時間必須是 1 至 3650 的整數。");
        return;
      }
      if (form.recurrence_mode === "weekly" && form.recurrence_weekdays.length === 0) {
        setError("每星期重複請至少選擇一天。");
        return;
      }
      if (form.recurrence_end_mode === "date" && (!form.recurrence_ends_on || form.recurrence_ends_on < dueDate)) {
        setError("Routine 結束日期不可早過首次到期日。");
        return;
      }
    }

    setSaving(true);

    const completedAt =
      form.status === "done" ? initialTask?.completed_at ?? new Date().toISOString() : null;

    // A restored draft can refer to a Tag since removed elsewhere. Only trim it
    // after confirming the current catalogue; an unavailable catalogue is not empty.
    const selectedTags = catalogRead ? form.tag_ids.filter(id => catalog.some(tag => tag.id === id)) : form.tag_ids;
    const changedLegacyPriority = initialTask && initialTask.priority_grade == null && !gradeChanged && tagsTouched
      ? taskTagPriorityChange(baselineTags, selectedTags, catalog) : undefined;
    const payload = {
      area: form.area,
      // Unedited tags are not rewritten; [] on edit explicitly removes all tags.
      tagIds: initialTask ? (tagsTouched ? selectedTags : undefined) : (selectedTags.length ? selectedTags : undefined),
      clientRequestId: form.client_request_id || crypto.randomUUID(),
      sourceType: form.source_type,
      title: form.title.trim(),
      addToToday: form.add_to_today,
      dueDate: dueDate || null,
      workStartDate: workSchedule.startDate,
      workDates: workSchedule.workDates,
      followUpDate: form.follow_up_date || null,
      waitingFor: form.waiting_for.trim() || null,
      waitingOn: form.waiting_on.trim() || null,
      status: form.status,
      customStatusLabel: form.custom_status_label.trim() || null,
      nextAction: form.next_action.trim() || null,
      requestedPriority: taskPriorityGrades.find((grade) => grade.value === selectedPriority)?.rank ?? priorityFromTaskTags(selectedTags, catalog) ?? 3,
      ...(!initialTask && selectedPriority ? { priorityGrade: selectedPriority, priorityDeadlineMode: form.priority_deadline_mode } : {}),
      notes: form.notes.trim() || null,
      owner: form.owner.trim() || null,
      completedAt,
      handoffToUserId: form.handoff_to_user_id || null,
      handoffNote: form.handoff_note.trim() || form.title.trim(),
      noticeUserIds: form.notice_user_ids,
      followerUserIds: form.follower_user_ids
    };
    let savedTask: Task | null = null;
    try {
      if (initialTask) {
        const updated = await controlAction<{ task: Task }>("update_task", { id: initialTask.id, tagIds: payload.tagIds, noticeUserIds: payload.noticeUserIds, followerUserIds: payload.followerUserIds, ...(gradeChanged ? { priorityGrade: form.priority_grade } : {}), changes: {
          title: payload.title, due_date: payload.dueDate, work_start_date: payload.workStartDate, work_dates: payload.workDates, follow_up_date: payload.followUpDate,
          waiting_for: payload.waitingFor, waiting_on: payload.waitingOn,
          status: payload.status, custom_status_label: payload.customStatusLabel,
          next_action: payload.nextAction,
          notes: payload.notes, completed_at: payload.completedAt,
          ...(changedLegacyPriority === undefined ? {} : { requested_priority: changedLegacyPriority })
        } });
        savedTask = { ...updated.task, personal_tag_ids: updated.task.personal_tag_ids ?? selectedTags };
        if (form.recurrence_enabled && !initialTask.recurrence_rule_id) {
          try {
            await controlAction("save_task_recurrence", recurrencePayload(initialTask.id));
          } catch (caught) {
            setCreatedTaskId(initialTask.id);
            setRecurrenceWarning(caught instanceof Error ? caught.message : "任務已更新，但未能設定 Routine 工作。");
            setSaving(false);
            return;
          }
        }
      } else {
        const created = await controlAction<{ task: Task }>("create_task", payload);
        savedTask = created.task;
        try { sessionStorage.removeItem(draftKey); } catch { /* The server has already saved the task. */ }
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
    if (!initialTask) {
      try { sessionStorage.removeItem(draftKey); } catch { /* Saving succeeded outside browser storage. */ }
      setForm({ ...defaultState, ...preset, priority_deadline_mode: preset?.priority_deadline_mode ?? (preset?.due_date ? "manual" : "auto"), client_request_id: crypto.randomUUID() });
      setOptionsOpen(false); setDraftRestored(false); setTagsTouched(false);
    }
    if (savedTask) {
      onSaved({
        task: savedTask,
        refreshRelated: form.add_to_today || form.recurrence_enabled || Boolean(form.handoff_to_user_id)
          || form.notice_user_ids.length > 0 || initialNoticeUserIds.length > 0
          || form.follower_user_ids.length > 0 || initialFollowerUserIds.length > 0
      });
    } else {
      onSaved();
    }
  }

  return (
    <form className="grid min-w-0 gap-3" aria-label={initialTask ? "修改 Task" : "新增 Task"} onSubmit={save}>
      {draftRestored ? <p className="rounded-xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-900" role="status">已恢復上次未送出的任務草稿；成功儲存前會繼續自動保留。</p> : null}
      {draftError ? <p role="status" className="text-sm text-amber-800">{draftError}</p> : null}
      {createdTaskId ? (
        <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4" aria-live="polite">
          <p className="font-extrabold text-amber-950">任務已建立，但重複工作尚未設定。</p>
          <p className="mt-1 text-sm leading-6 text-amber-900">{recurrenceWarning || "任務沒有遺失；你可以重試，或先返回任務列表。"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void retryRecurrence()} disabled={saving}>{saving ? "設定中…" : "重試設定重複工作"}</Button>
            <Button type="button" variant="secondary" onClick={() => onSaved()}>先查看任務</Button>
          </div>
        </section>
      ) : null}
      <div className={inline ? "flex flex-wrap items-end gap-2" : ""}><label className="block min-w-0 flex-1">
        <span className="label">任務名稱</span>
        <input id={inline ? "dashboard-task-name" : undefined} className="field mt-1" placeholder="寫低要做嘅事，或者用鍵盤聽寫" value={form.title} onChange={(event) => update("title", event.target.value)} autoFocus={!inline} required maxLength={250}/>
      </label>
      {inline ? <Button type="submit" className="simple-add-task shrink-0 whitespace-nowrap" disabled={saving || Boolean(createdTaskId)}>{saving ? "儲存中…" : "儲存任務"}</Button> : null}</div>
      <div>
        <label htmlFor={priorityPickerId} className="label block">優先級 Priority（選填）</label>
        <select id={priorityPickerId} className="field mt-1" value={selectedPriority ?? ""} aria-describedby={priorityHintId} disabled={saving || Boolean(initialTask && (initialTask.owner_id ?? initialTask.user_id) !== userId)}
          onChange={(event) => setForm((current) => ({ ...current, priority_grade: parseTaskPriorityGrade(event.target.value) }))}>
          <option value="" disabled={Boolean(initialPriority)}>未設定優先級</option>
          {taskPriorityGrades.map((grade) => <option key={grade.value} value={grade.value}>{grade.label} · {grade.duration}</option>)}
        </select>
        <p id={priorityHintId} className="muted mt-1 text-xs leading-5">
          {initialTask
            ? "改分級唔會改 Deadline；改日期亦唔會改分級。"
            : autoDeadline
              ? `預設 Deadline：${dueDate}。你可以改日期，分級會保留。`
              : selectedPriority
                ? dueDate ? `自訂 Deadline：${dueDate}。改日期唔會改分級。` : "你已揀無 Deadline；分級會保留。"
                : "揀咗分級會有預設 Deadline；你自己揀嘅日期會保留。"}
        </p>
      </div>
      <TaskTagPicker key={initialTask?.id ?? form.client_request_id} value={form.tag_ids} taskId={initialTask?.id} initialCatalog={knownTags} disabled={saving}
        onCatalog={(tags) => { setCatalog(tags); setCatalogRead(true); }}
        onLoadedValue={(tag_ids) => { setBaselineTags(tag_ids); setForm(current => ({ ...current, tag_ids })); }}
        onChange={(tag_ids) => { setTagsTouched(true); setForm(current => ({ ...current, tag_ids })); }} />
      {!initialTask ? <button type="button" aria-expanded={optionsOpen} onClick={()=>setOptionsOpen(!optionsOpen)} className="min-h-11 justify-self-start text-left text-sm text-slate-700"><span>{form.handoff_to_user_id ? participants.find(p=>p.user_id===form.handoff_to_user_id)?.display_name || "已揀跟進者" : "我自己"} · {dueDate || "無 Deadline"}</span>　<span className="font-bold text-indigo-700 underline">{optionsOpen?"收起設定":"更改設定"}</span></button> : null}
      <div hidden={!optionsOpen && !initialTask}><div className="grid gap-4">
      {!initialTask ? <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 font-bold text-indigo-950">
        <input className="h-5 w-5 accent-indigo-600" type="checkbox" checked={form.add_to_today} disabled={!["not_started", "in_progress"].includes(form.status)} onChange={(event) => update("add_to_today", event.target.checked)} />
        加入今日 Today
      </label> : null}
      <details className="rounded-2xl border border-slate-200 p-3">
        <summary className="min-h-11 cursor-pointer py-2 font-bold text-slate-700">日期／邊個跟 <span className="text-xs font-normal text-slate-500">{dueDate || "無 Deadline"} · {form.handoff_to_user_id ? participants.find((person) => person.user_id === form.handoff_to_user_id)?.display_name : "我自己"}</span></summary>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <DueDatePicker
          value={dueDate}
          label="Deadline（可留空）"
          onChange={(value) => setForm((current) => ({ ...current, due_date: value, priority_deadline_mode: "manual" }))}
        />
      {!initialTask ? <label>
        <span className="label">邊個跟？</span>
        <select className="field mt-2" value={form.handoff_to_user_id} onChange={(event) => update("handoff_to_user_id", event.target.value)}>
          <option value="">我自己</option>
          {otherParticipants.map((participant) => <option key={participant.user_id} value={participant.user_id}>{participant.display_name}</option>)}
        </select>
        <span className="mt-1 block text-xs leading-5 text-slate-600">選另一位會在建立後直接交給對方確認及跟進。</span>
      </label> : <p className="self-center text-sm text-slate-500">轉交工作請用 Task 詳情內的「交接」，保留完整紀錄。</p>}
      </div>
      {!initialTask && form.handoff_to_user_id ? <label>
        <span className="label">交接 Notes（可留空）</span>
        <textarea className="field mt-2 min-h-24" value={form.handoff_note} onChange={(event) => update("handoff_note", event.target.value)} placeholder="有咩要對方留意？留空會用任務名稱交接。" maxLength={500} />
      </label> : null}
      </details>
      <details className="rounded-2xl border border-slate-200 bg-white p-4" open={initialTask?.status === "waiting" || undefined}>
        <summary className="min-h-11 cursor-pointer py-2 font-bold text-slate-700">更多設定 <span className="ml-1 text-xs font-normal text-slate-500">備註、工作日、重複、共同跟進</span></summary>
        <div className="mt-3 grid gap-4">
      <label><span className="label">Follow-up 跟進日</span><input className="field mt-2" type="date" value={form.follow_up_date} onChange={(event) => update("follow_up_date", event.target.value)} /></label>
      {!compact && otherParticipants.length ? (
        <fieldset className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <legend className="px-1 font-extrabold text-slate-900">由誰共同跟進？</legend>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            可同時選擇多人。你仍是任務擁有者；被選的人可查看及更新進度。
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {otherParticipants.map((participant) => (
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 font-semibold text-slate-800" key={participant.user_id}>
                <input
                  className="h-5 w-5 accent-indigo-600"
                  type="checkbox"
                  checked={form.follower_user_ids.includes(participant.user_id)}
                  onChange={() => toggleFollower(participant.user_id)}
                />
                {participant.display_name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {!initialTask?.recurrence_rule_id ? (
        <details className="rounded-2xl border border-slate-200 p-3">
          <summary className="min-h-11 cursor-pointer py-2 font-extrabold text-slate-900">自訂哪幾日做／提醒{form.work_dates.length ? `（已揀 ${form.work_dates.length} 日）` : "（選填）"}</summary>
          <TaskWorkDaysPicker
            startDate={form.work_start_date}
            dueDate={dueDate}
            workDates={form.work_dates}
            disabled={saving}
            onChange={(startDate, workDates) => setForm((current) => ({ ...current, work_start_date: startDate, work_dates: workDates }))}
          />
        </details>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="label">系統狀態</span>
          <select className="field mt-2" value={form.status} onChange={(event) => {
            const status = event.target.value;
            setForm((current) => ({ ...current, status, add_to_today: ["not_started", "in_progress"].includes(status) && current.add_to_today }));
          }}>
            {taskStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <span className="mt-1 block text-xs leading-5 text-slate-500">系統用這個狀態判斷 Today、Waiting、Blocked 及完成項目。</span>
        </label>
        <label>
          <span className="label">自訂顯示狀態（可留空）</span>
          <input className="field mt-2" list={customStatusListId} value={form.custom_status_label} onChange={(event) => update("custom_status_label", event.target.value)} placeholder="例如：等學校確認、準備文件中" maxLength={60} />
          <datalist id={customStatusListId}>{statusSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist>
          <span className="mt-1 block text-xs leading-5 text-slate-500">只改顯示名稱；輸入過的名稱之後可再選。</span>
        </label>
      </div>
      {form.status === "in_progress" ? (
        <label>
          <span className="label">下一個小步驟</span>
          <input
            className="field mt-2"
            value={form.next_action}
            onChange={(event) => update("next_action", event.target.value)}
            placeholder="例如：打開申請表，先填第一頁"
            maxLength={500}
            required
          />
          <span className="mt-1 block text-xs leading-5 text-slate-500">只在「進行中」時需要，幫你中斷後毋須重新思考。</span>
        </label>
      ) : null}
      {form.status === "waiting" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="label">等待誰</span>
            <input className="field mt-2" value={form.waiting_for} onChange={(event) => update("waiting_for", event.target.value)} placeholder="例如：學校、會計師、Suki" maxLength={200} />
          </label>
          <label>
            <span className="label">等待內容</span>
            <input className="field mt-2" value={form.waiting_on} onChange={(event) => update("waiting_on", event.target.value)} placeholder="例如：確認日期、回覆文件" maxLength={300} />
          </label>
        </div>
      ) : null}
      {compact && otherParticipants.length ? <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-3"><legend className="px-1 text-sm font-extrabold text-slate-900">共同跟進（可多選）</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{otherParticipants.map((participant) => <label className="flex items-center gap-3 rounded-lg bg-white p-3 text-sm font-semibold text-slate-800" key={participant.user_id}><input className="h-5 w-5 accent-indigo-600" type="checkbox" checked={form.follower_user_ids.includes(participant.user_id)} onChange={() => toggleFollower(participant.user_id)} />{participant.display_name}</label>)}</div></fieldset> : null}
      {!initialTask?.recurrence_rule_id ? (
        <fieldset className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              className="mt-1 h-5 w-5 accent-indigo-600"
              type="checkbox"
              checked={form.recurrence_enabled}
              onChange={(event) => update("recurrence_enabled", event.target.checked)}
            />
            <span>
              <span className="block font-extrabold text-slate-900">這是一項 Routine 工作</span>
              <span className="mt-1 block text-sm leading-6 text-slate-600">完成今次後才會建立下一次。遲完成亦會沿用原定到期日計算，不會令整個 schedule 越推越遲。</span>
            </span>
          </label>
          {form.recurrence_enabled ? (
            <div className="mt-4 grid gap-4">
              <fieldset>
                <legend className="label">重複方式</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className={`cursor-pointer rounded-xl border-2 bg-white p-3 ${form.recurrence_mode === "interval" ? "border-indigo-600 ring-2 ring-indigo-100" : "border-slate-200"}`}>
                    <input className="mr-2 h-4 w-4 accent-indigo-600" type="radio" name="recurrence-mode" checked={form.recurrence_mode === "interval"} onChange={() => update("recurrence_mode", "interval")} />
                    <span className="font-bold text-slate-900">每隔一段時間</span>
                  </label>
                  <label className={`cursor-pointer rounded-xl border-2 bg-white p-3 ${form.recurrence_mode === "weekly" ? "border-indigo-600 ring-2 ring-indigo-100" : "border-slate-200"}`}>
                    <input className="mr-2 h-4 w-4 accent-indigo-600" type="radio" name="recurrence-mode" checked={form.recurrence_mode === "weekly"} onChange={() => update("recurrence_mode", "weekly")} />
                    <span className="font-bold text-slate-900">每星期指定日子</span>
                  </label>
                </div>
              </fieldset>
              {form.recurrence_mode === "interval" ? (
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3">
                  <label>
                    <span className="label">每隔</span>
                    <input className="field mt-2 bg-white" type="number" min="1" max="3650" value={form.recurrence_interval_value} onChange={(event) => update("recurrence_interval_value", event.target.value)} required />
                  </label>
                  <label>
                    <span className="label">時限</span>
                    <select className="field mt-2 bg-white" value={form.recurrence_interval_unit} onChange={(event) => update("recurrence_interval_unit", event.target.value)}>
                      <option value="day">日</option>
                      <option value="month">月</option>
                      <option value="year">年</option>
                    </select>
                  </label>
                </div>
              ) : (
                <fieldset>
                  <legend className="label">星期幾（可多選）</legend>
                  <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
                    {routineWeekdays.map((weekday) => {
                      const checked = form.recurrence_weekdays.includes(weekday.value);
                      return (
                        <label key={weekday.value} className={`cursor-pointer rounded-xl border-2 p-3 text-center font-extrabold ${checked ? "border-indigo-600 bg-indigo-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700"}`}>
                          <input className="sr-only" type="checkbox" checked={checked} onChange={() => toggleRecurrenceWeekday(weekday.value)} />
                          週{weekday.label}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              {dueDate && nextRoutineDueDate ? (
                <p className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-indigo-800" aria-live="polite">
                  首次到期：{formatRoutineDate(dueDate)} · 如完成，下一次：{formatRoutineDate(nextRoutineDueDate)}
                </p>
              ) : <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">{dueDate && form.recurrence_mode === "weekly" ? "請至少選擇一個星期日子。" : "請先在上方設定首次到期日。"}</p>}
              <fieldset>
                <legend className="label">幾時完結</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className={`cursor-pointer rounded-xl border-2 bg-white p-3 ${form.recurrence_end_mode === "never" ? "border-indigo-600 ring-2 ring-indigo-100" : "border-slate-200"}`}>
                    <input className="mr-2 h-4 w-4 accent-indigo-600" type="radio" name="recurrence-end-mode" checked={form.recurrence_end_mode === "never"} onChange={() => update("recurrence_end_mode", "never")} />
                    <span className="font-bold text-slate-900">無限期</span>
                  </label>
                  <label className={`cursor-pointer rounded-xl border-2 bg-white p-3 ${form.recurrence_end_mode === "date" ? "border-indigo-600 ring-2 ring-indigo-100" : "border-slate-200"}`}>
                    <input className="mr-2 h-4 w-4 accent-indigo-600" type="radio" name="recurrence-end-mode" checked={form.recurrence_end_mode === "date"} onChange={() => update("recurrence_end_mode", "date")} />
                    <span className="font-bold text-slate-900">指定結束日期</span>
                  </label>
                </div>
              </fieldset>
              {form.recurrence_end_mode === "date" ? (
                <label><span className="label">結束日期</span><input className="field mt-2 bg-white" type="date" min={dueDate || undefined} value={form.recurrence_ends_on} onChange={(event) => update("recurrence_ends_on", event.target.value)} required /></label>
              ) : null}
              <p className="text-xs font-semibold leading-5 text-slate-600">不設「重複次數」。到指定結束日期後，系統會自動停止建立下一次。</p>
            </div>
          ) : null}
        </fieldset>
      ) : null}
      {!compact ? (
        <details className="rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer font-extrabold text-slate-900">
            更多選項
            <span className="ml-2 text-xs font-medium text-slate-500">備註及通知</span>
          </summary>
          <div className="mt-4 grid gap-4">
          <label>
            <span className="label">備註</span>
            <textarea className="field mt-2 min-h-28" value={form.notes} onChange={(event) => update("notes", event.target.value)} />
          </label>
          {otherParticipants.length ? (
            <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <legend className="px-1 text-sm font-extrabold text-slate-900">通知誰（可選）</legend>
              <p className="text-sm leading-6 text-slate-600">只接收提醒，不會取得更改內容的權限。</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {otherParticipants.map((participant) => (
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-white p-3 text-sm font-semibold text-slate-800" key={participant.user_id}>
                    <input className="h-5 w-5 accent-indigo-600" type="checkbox" checked={form.notice_user_ids.includes(participant.user_id)} onChange={() => toggleNotice(participant.user_id)} />
                    通知 {participant.display_name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          </div>
        </details>
      ) : null}
        </div>
      </details>
      </div></div>
      {error ? <p className="rounded-lg bg-amber-50 p-3 text-base font-semibold text-amber-900" role="alert">{error}</p> : null}
      {!inline ? <div className="sticky bottom-0 z-10 flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <Button type="submit" disabled={saving || Boolean(createdTaskId)}>
          {saving ? "儲存中..." : initialTask ? "儲存修改" : "加 Task"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            取消
          </Button>
        ) : null}
      </div> : null}
    </form>
  );
}
