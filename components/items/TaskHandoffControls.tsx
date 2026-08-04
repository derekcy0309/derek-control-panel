"use client";

import { useMemo, useState } from "react";
import { ArrowRightLeft, CheckCircle2, CheckSquare2, Clock3, MessageSquareText } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import type { Assignment, HandoffNote, Task } from "@/lib/types";

type Participant = { user_id: string; display_name: string };
type Resolution = "continue" | "return" | "close";
type HandlerSwitchMode = "assign" | "return" | "reclaim" | "transfer";
const activeStatuses = ["pending_acceptance", "accepted", "in_progress", "waiting", "blocked"] as const;

export function TaskHandoffControls({
  task,
  currentUserId,
  participants,
  assignments,
  notes,
  onChanged
}: {
  task: Task;
  currentUserId: string;
  participants: Participant[];
  assignments: Assignment[];
  notes: HandoffNote[];
  onChanged: () => void;
}) {
  const [handlerSwitch, setHandlerSwitch] = useState<{ target: Participant; mode: HandlerSwitchMode } | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveMode, setResolveMode] = useState<Resolution>("continue");
  const [error, setError] = useState("");
  const taskAssignments = useMemo(
    () => assignments.filter((item) => item.resource_type === "task" && item.resource_id === task.id),
    [assignments, task.id]
  );
  const active = taskAssignments.find((item) => activeStatuses.includes(item.status as (typeof activeStatuses)[number]));
  const taskNotes = notes.filter((item) => item.task_id === task.id).slice(0, 3);
  const otherParticipants = participants.filter((item) => item.user_id !== currentUserId);
  const selfParticipant = participants.find((item) => item.user_id === currentUserId) ?? {
    user_id: currentUserId,
    display_name: "我"
  };
  const handlerChoices = [selfParticipant, ...otherParticipants];
  const ownerId = task.owner_id ?? task.user_id;
  const isOwner = ownerId === currentUserId;
  const isRecipient = active?.assigned_to_id === currentUserId;
  const isSender = active?.assigned_by_id === currentUserId;
  const closed = task.status === "done" || task.status === "cancelled";
  const currentHandlerId = active?.assigned_to_id ?? task.assignee_id ?? ownerId;
  const currentHandlerName = currentHandlerId === currentUserId
    ? "我"
    : participantName(participants, currentHandlerId);

  function switchModeFor(targetUserId: string): HandlerSwitchMode | null {
    if (closed || targetUserId === currentHandlerId) return null;
    if (!active) return isOwner && targetUserId !== currentUserId ? "assign" : null;
    if (isSender && targetUserId === active.assigned_by_id) return "reclaim";
    if (isRecipient && active.status !== "pending_acceptance") {
      return targetUserId === active.assigned_by_id ? "return" : "transfer";
    }
    return null;
  }

  async function respond(response: "accept" | "decline") {
    if (!active) return;
    setError("");
    try {
      await controlAction("assignment_response", {
        id: active.id,
        response,
        reason: response === "decline" ? "暫時未能處理" : undefined
      });
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught, "未能處理交接。"));
    }
  }

  return (
    <section className="mt-4 rounded-2xl border-2 border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-xl bg-indigo-600 p-2 text-white" aria-hidden="true">
          <ArrowRightLeft className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-wider text-indigo-600">目前負責人</p>
          <p className="mt-1 text-lg font-extrabold text-slate-900">現在由 {currentHandlerName} 跟進</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            按另一位即可轉交；每次轉交都要寫 notes，舊紀錄及時間不會消失。
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2" role="group" aria-label="選擇任務跟進者">
        {handlerChoices.map((participant) => {
          const selected = participant.user_id === currentHandlerId;
          const mode = switchModeFor(participant.user_id);
          const isSelf = participant.user_id === currentUserId;
          return (
            <button
              key={participant.user_id}
              type="button"
              className={`min-h-20 rounded-xl border-2 p-4 text-left transition ${
                selected
                  ? "cursor-default border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100"
                  : mode
                    ? "border-indigo-300 bg-white hover:border-indigo-600 hover:bg-indigo-50"
                    : "cursor-not-allowed border-slate-200 bg-slate-100 opacity-65"
              }`}
              disabled={!mode}
              aria-pressed={selected}
              onClick={() => {
                if (!mode) return;
                setError("");
                setHandlerSwitch({ target: participant, mode });
              }}
            >
              <span className="flex items-center gap-2 font-extrabold text-slate-900">
                {selected ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <ArrowRightLeft className="h-5 w-5 text-indigo-600" />}
                {selected ? (isSelf ? "由我跟進" : `由 ${participant.display_name} 跟進`) : isSelf ? "改由我跟進" : `轉交 ${participant.display_name}`}
              </span>
              <span className="mt-1 block text-sm leading-5 text-slate-600">
                {selected
                  ? "目前負責人"
                  : mode
                    ? "按此轉交跟進"
                    : active?.status === "pending_acceptance" && isRecipient
                      ? "請先接受或暫不接手"
                      : "目前不可由你更改"}
              </span>
            </button>
          );
        })}
        {!otherParticipants.length ? (
          <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 p-4 sm:col-span-2">
            <p className="font-bold text-amber-900">Suki 選項暫時未能載入</p>
            <p className="mt-1 text-sm text-amber-800">請重新整理頁面；系統不會再把指派控制隱藏。</p>
          </div>
        ) : null}
      </div>

      {active ? (
        <div className="mt-3 border-t border-indigo-100 pt-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-white px-2.5 py-1 font-bold text-indigo-700 ring-1 ring-indigo-100">
              {assignmentStatusLabel[active.status]}
            </span>
            <span className="text-slate-600">
              {participantName(participants, active.assigned_by_id)} → {participantName(participants, active.assigned_to_id)}
            </span>
            <span className="font-semibold text-slate-600">進度 {active.progress ?? task.progress ?? 0}%</span>
          </div>
          {active.next_step ? <p className="mt-2 text-sm"><span className="font-bold">下一步：</span>{active.next_step}</p> : null}
          {active.waiting_until ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
              <Clock3 className="h-4 w-4" />等到 {formatDateTime(active.waiting_until)}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {isRecipient && active.status === "pending_acceptance" ? (
              <>
                <Button onClick={() => respond("accept")}>接受跟進</Button>
                <Button variant="secondary" onClick={() => respond("decline")}>暫不接手</Button>
              </>
            ) : null}
            {isRecipient && active.status !== "pending_acceptance" ? (
              <>
                <Button variant="secondary" onClick={() => setProgressOpen(true)}>
                  <MessageSquareText className="h-4 w-4" />更新進度／notes
                </Button>
                <Button variant="success" onClick={() => { setResolveMode("continue"); setResolveOpen(true); }}>
                  <CheckSquare2 className="h-4 w-4" />完成這一步
                </Button>
                <Button variant="secondary" onClick={() => { setResolveMode("return"); setResolveOpen(true); }}>
                  <ArrowRightLeft className="h-4 w-4" />交回 {participantName(participants, active.assigned_by_id)} 跟進
                </Button>
              </>
            ) : null}
            {isSender ? <span className="self-center text-sm font-semibold text-slate-600">你可查看進度，或在上方按「由我跟進」直接收回。</span> : null}
          </div>
        </div>
      ) : null}

      {taskNotes.length ? (
        <div className="mt-3 border-t border-indigo-100 pt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">最近交接 notes</p>
          <ol className="mt-2 space-y-2">
            {taskNotes.map((note) => (
              <li key={note.id} className="rounded-lg bg-white/80 p-3 text-sm">
                <p className="whitespace-pre-wrap break-words text-slate-800">{note.body}</p>
                {note.next_step ? <p className="mt-1 text-slate-600"><span className="font-bold">下一步：</span>{note.next_step}</p> : null}
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {participantName(participants, note.author_id)} · {formatDateTime(note.created_at)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {error ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}
      {handlerSwitch ? (
        <SwitchHandlerModal
          task={task}
          assignment={active}
          target={handlerSwitch.target}
          mode={handlerSwitch.mode}
          onClose={() => setHandlerSwitch(null)}
          onSaved={() => { setHandlerSwitch(null); onChanged(); }}
        />
      ) : null}
      {progressOpen && active ? (
        <ProgressModal
          task={task}
          assignment={active}
          onClose={() => setProgressOpen(false)}
          onSaved={() => { setProgressOpen(false); onChanged(); }}
        />
      ) : null}
      {resolveOpen && active ? (
        <ResolveStepModal
          assignment={active}
          previousActor={participantName(participants, active.assigned_by_id)}
          initialResolution={resolveMode}
          onClose={() => setResolveOpen(false)}
          onSaved={() => { setResolveOpen(false); onChanged(); }}
        />
      ) : null}
    </section>
  );
}

function SwitchHandlerModal({
  task,
  assignment,
  target,
  mode,
  onClose,
  onSaved
}: {
  task: Task;
  assignment?: Assignment;
  target: Participant;
  mode: HandlerSwitchMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode !== "assign" && !assignment) {
      setError("找不到目前交接紀錄，請重新整理後再試。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (mode === "assign") {
        await controlAction("handoff_task", {
          taskId: task.id,
          targetUserId: target.user_id,
          note,
          dueDate
        });
      } else if (mode === "return") {
        await controlAction("handoff_resolve", {
          assignmentId: assignment!.id,
          resolution: "return",
          note,
          nextStep: "",
          waitingUntil: ""
        });
      } else if (mode === "reclaim") {
        await controlAction("handoff_reclaim", {
          assignmentId: assignment!.id,
          note
        });
      } else {
        await controlAction("handoff_transfer", {
          assignmentId: assignment!.id,
          targetUserId: target.user_id,
          note,
          dueDate
        });
      }
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught, "未能更改跟進者。"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`改由 ${target.display_name} 跟進`} onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <div className="rounded-xl bg-indigo-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">任務</p>
          <p className="mt-1 font-bold text-slate-900">{task.title}</p>
          <p className="mt-2 text-sm font-semibold text-indigo-800">
            新跟進者：{target.display_name}
          </p>
        </div>
        <label>
          <span className="label">轉交 notes（雙方都會永久看到）</span>
          <textarea
            className="field mt-2 min-h-28"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：已完成今個 step，請下一手明日下午再追文件。"
            maxLength={500}
            required
          />
        </label>
        {mode === "assign" || mode === "transfer" ? (
          <label>
            <span className="label">今次跟進期限（可留空）</span>
            <input className="field mt-2" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
        ) : null}
        <p className="text-sm leading-6 text-slate-600">
          {mode === "assign" || mode === "transfer"
            ? "對方接受後負責跟進；只可選擇系統內現有並已連接的帳戶，任務及舊紀錄會繼續保留。"
            : "確認後會立即改變目前跟進者，並保留全部 notes、操作者及日期時間。"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>{saving ? "更改中…" : "確認更改跟進者"}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        </div>
        {error ? <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}

function ProgressModal({
  task,
  assignment,
  onClose,
  onSaved
}: {
  task: Task;
  assignment: Assignment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<"in_progress" | "waiting" | "blocked">(
    assignment.status === "waiting" || assignment.status === "blocked" ? assignment.status : "in_progress"
  );
  const [progress, setProgress] = useState(assignment.progress ?? task.progress ?? 0);
  const [note, setNote] = useState("");
  const [nextStep, setNextStep] = useState(assignment.next_step ?? "");
  const [waitingUntil, setWaitingUntil] = useState(toLocalInput(assignment.waiting_until));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await controlAction("handoff_progress", {
        assignmentId: assignment.id,
        status,
        progress,
        note,
        nextStep,
        waitingUntil
      });
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught, "未能更新進度。"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="更新個案進度" onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="label">目前狀態</span>
            <select className="field mt-2" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option value="in_progress">跟進中</option>
              <option value="waiting">等待結果</option>
              <option value="blocked">遇到阻礙</option>
            </select>
          </label>
          <label>
            <span className="label">個案進度：{progress}%</span>
            <input className="mt-4 w-full accent-indigo-600" type="range" min={0} max={100} step={5} value={progress} onChange={(event) => setProgress(Number(event.target.value))} />
          </label>
        </div>
        <label>
          <span className="label">今次 notes</span>
          <textarea className="field mt-2 min-h-28" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} required />
        </label>
        <label>
          <span className="label">下一步（可留空）</span>
          <input className="field mt-2" value={nextStep} onChange={(event) => setNextStep(event.target.value)} maxLength={500} />
        </label>
        {status === "waiting" ? (
          <label>
            <span className="label">預計何時再跟進</span>
            <input className="field mt-2" type="datetime-local" value={waitingUntil} onChange={(event) => setWaitingUntil(event.target.value)} />
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>{saving ? "儲存中…" : "儲存進度"}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        </div>
        {error ? <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}

function ResolveStepModal({
  assignment,
  previousActor,
  initialResolution,
  onClose,
  onSaved
}: {
  assignment: Assignment;
  previousActor: string;
  initialResolution: Resolution;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [resolution, setResolution] = useState<Resolution>(initialResolution);
  const [note, setNote] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [waitingUntil, setWaitingUntil] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (resolution === "close" && !window.confirm("這會把整個個案標記為已完成。確定完全結案？")) return;
    setSaving(true);
    setError("");
    try {
      await controlAction("handoff_resolve", {
        assignmentId: assignment.id,
        resolution,
        note,
        nextStep,
        waitingUntil
      });
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught, "未能完成這一步。"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="完成這一步後怎樣處理？" onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <fieldset>
          <legend className="label">個案去向</legend>
          <div className="mt-2 grid gap-2">
            <ResolutionOption
              checked={resolution === "continue"}
              onChange={() => setResolution("continue")}
              title="完成今步，我繼續跟進"
              detail="適合已做一個 step、需要等待結果，之後仍由你繼續。任務不會完成。"
            />
            <ResolutionOption
              checked={resolution === "return"}
              onChange={() => setResolution("return")}
              title={`交回 ${previousActor} 繼續跟進`}
              detail="保留完整紀錄，建立下一段交接，上一手可立即接續。"
            />
            <ResolutionOption
              checked={resolution === "close"}
              onChange={() => setResolution("close")}
              title="完全結案"
              detail="只有確定整個個案已完成才選擇；這會把任務進度設為 100%。"
            />
          </div>
        </fieldset>
        <label>
          <span className="label">今步完成 notes</span>
          <textarea
            className="field mt-2 min-h-28"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="寫下已完成的 step、結果及下手需要知道的資料。"
            maxLength={500}
            required
          />
        </label>
        {resolution !== "close" ? (
          <>
            <label>
              <span className="label">下一步</span>
              <input className="field mt-2" value={nextStep} onChange={(event) => setNextStep(event.target.value)} maxLength={500} />
            </label>
            <label>
              <span className="label">如果要等結果，何時再跟進</span>
              <input className="field mt-2" type="datetime-local" value={waitingUntil} onChange={(event) => setWaitingUntil(event.target.value)} />
            </label>
          </>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant={resolution === "close" ? "danger" : "success"} disabled={saving}>
            <ArrowRightLeft className="h-4 w-4" />{saving ? "處理中…" : "確認"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        </div>
        {error ? <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}

function ResolutionOption({
  checked,
  onChange,
  title,
  detail
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${checked ? "border-indigo-500 bg-indigo-50" : "border-slate-200"}`}>
      <input className="mt-1 h-5 w-5 accent-indigo-600" type="radio" checked={checked} onChange={onChange} />
      <span>
        <span className="block font-bold text-slate-900">{title}</span>
        <span className="mt-1 block text-sm leading-5 text-slate-600">{detail}</span>
      </span>
    </label>
  );
}

function participantName(participants: Participant[], userId: string) {
  return participants.find((item) => item.user_id === userId)?.display_name ?? "對方";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function toLocalInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

const assignmentStatusLabel: Record<Assignment["status"], string> = {
  pending_acceptance: "等待接受",
  accepted: "已接受",
  declined: "已婉拒",
  clarification_requested: "需要補充資料",
  alternative_date_proposed: "建議改期",
  in_progress: "跟進中",
  waiting: "等待結果",
  blocked: "遇到阻礙",
  completed: "已完成",
  returned: "已交回上一手",
  closed: "已完全結案",
  cancelled: "已取消"
};
