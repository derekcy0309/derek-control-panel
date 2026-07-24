"use client";

import { useEffect, useState } from "react";
import {
  CalendarPlus,
  CheckCircle2,
  Clock3,
  FolderKanban,
  Forward,
  ListPlus,
  NotebookPen,
  Play,
  RotateCcw,
  SkipForward
} from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { processInboxItem, undoLastInboxProcessing } from "@/lib/control-api";
import type {
  InboxProcessingAction,
  InboxProcessingBundle,
  OperatingItem
} from "@/lib/types";

type InboxProcessingModeProps = {
  bundle: InboxProcessingBundle;
  sessionId: string;
  onChanged: () => Promise<void>;
};

type ProcessingForm = {
  title: string;
  description: string;
  nextAction: string;
  area: "work" | "family" | "personal";
  estimatedMinutes: string;
  energyLevel: "" | "low" | "medium" | "high";
  context: string;
  dueDate: string;
  plannedDate: string;
  handoffToUserId: string;
  handoffNote: string;
  notes: string;
};

const actions: Array<{
  action: InboxProcessingAction;
  label: string;
  hint: string;
  icon: typeof Play;
}> = [
  { action: "do_now", label: "立即做", hint: "設定最小下一步後開始", icon: Play },
  { action: "create_task", label: "建立任務", hint: "加入現有 Tasks", icon: ListPlus },
  { action: "add_project", label: "加入 Project", hint: "放入項目作戰室", icon: FolderKanban },
  { action: "add_waiting", label: "加入 Waiting", hint: "保留下一次跟進", icon: Clock3 },
  { action: "assign", label: "交給 Derek／Suki", hint: "沿用雙人交接流程", icon: Forward },
  { action: "schedule", label: "安排日期", hint: "指定日子再處理", icon: CalendarPlus },
  { action: "keep_note", label: "保留作 Notes／Reference", hint: "不變成待辦工作", icon: NotebookPen },
  { action: "skip", label: "略過，稍後再處理", hint: "4 小時後再出現", icon: SkipForward }
];

export function InboxProcessingMode({
  bundle,
  sessionId,
  onChanged
}: InboxProcessingModeProps) {
  const [selectedAction, setSelectedAction] = useState<InboxProcessingAction | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [form, setForm] = useState<ProcessingForm>(() => emptyForm(bundle.currentItem));
  const [submitting, setSubmitting] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState("");

  const item = bundle.currentItem;

  useEffect(() => {
    setForm(emptyForm(item));
    setSelectedAction(null);
    setIdempotencyKey("");
    setError("");
  }, [item]);

  function openAction(action: InboxProcessingAction) {
    setError("");
    setIdempotencyKey(window.crypto.randomUUID());
    if (action === "skip") {
      void submit(action, window.crypto.randomUUID());
      return;
    }
    setSelectedAction(action);
  }

  function set<K extends keyof ProcessingForm>(key: K, value: ProcessingForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(
    action = selectedAction,
    requestKey = idempotencyKey
  ) {
    if (!item || !action || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await processInboxItem({
        inboxItemId: item.id,
        processingAction: action,
        sessionId,
        idempotencyKey: requestKey,
        options: {
          ...form,
          estimatedMinutes: form.estimatedMinutes
            ? Number(form.estimatedMinutes)
            : null
        }
      });
      setSelectedAction(null);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能處理這項內容。");
    } finally {
      setSubmitting(false);
    }
  }

  async function undo() {
    if (!bundle.lastUndoable || undoing) return;
    setUndoing(true);
    setError("");
    try {
      await undoLastInboxProcessing(bundle.lastUndoable.id);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能撤銷最近一次處理。");
    } finally {
      setUndoing(false);
    }
  }

  if (!item) {
    return (
      <section className="panel p-6 text-center sm:p-10">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-xl font-bold">目前可處理的收集箱已清理</h2>
        <p className="muted mx-auto mt-2 max-w-xl text-sm leading-6">
          {bundle.sessionProcessed > 0
            ? `今次已處理 ${bundle.sessionProcessed} 項。略過的內容會在稍後重新出現。`
            : "可以先離開；新增內容後再回來逐項整理。"}
        </p>
        {bundle.lastUndoable ? (
          <Button
            className="mt-5"
            variant="secondary"
            disabled={undoing}
            onClick={() => void undo()}
          >
            <RotateCcw className="h-4 w-4" />
            {undoing ? "撤銷中…" : "Undo 最近一次處理"}
          </Button>
        ) : null}
        {error ? <InlineError message={error} /> : null}
      </section>
    );
  }

  return (
    <>
      <section className="panel overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50/80 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Inbox Processing Mode</p>
              <p className="mt-1 text-sm font-bold">
                {bundle.position}／{Math.max(bundle.sessionTotal, 1)}
              </p>
            </div>
            {bundle.lastUndoable ? (
              <Button
                variant="secondary"
                disabled={undoing}
                onClick={() => void undo()}
              >
                <RotateCcw className="h-4 w-4" />
                {undoing ? "撤銷中…" : "Undo"}
              </Button>
            ) : null}
          </div>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-label="收集箱處理進度"
            aria-valuemin={0}
            aria-valuemax={Math.max(bundle.sessionTotal, 1)}
            aria-valuenow={bundle.sessionProcessed}
          >
            <div
              className="h-full rounded-full bg-indigo-500 transition-[width]"
              style={{
                width: `${Math.min(
                  100,
                  (bundle.sessionProcessed / Math.max(bundle.sessionTotal, 1)) * 100
                )}%`
              }}
            />
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <p className="muted text-xs font-bold uppercase tracking-[.12em]">今次只處理這一項</p>
          <h2 className="mt-2 break-words text-2xl font-bold">{item.title}</h2>
          {item.description ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
              {item.description}
            </p>
          ) : null}
          <p className="muted mt-3 text-xs">
            原始內容及來源會保留；系統不會在未確認下自行轉換。
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {actions.map(({ action, label, hint, icon: Icon }) => (
              <button
                key={action}
                type="button"
                className="min-h-16 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={submitting}
                onClick={() => openAction(action)}
              >
                <span className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-bold">{label}</span>
                    <span className="muted mt-1 block text-xs leading-5">{hint}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
          {submitting && selectedAction === null ? (
            <p className="muted mt-4 text-sm" role="status">處理中…</p>
          ) : null}
          {error && selectedAction === null ? <InlineError message={error} /> : null}
        </div>
      </section>

      {selectedAction ? (
        <ProcessingModal
          action={selectedAction}
          bundle={bundle}
          form={form}
          error={error}
          submitting={submitting}
          onSet={set}
          onClose={() => {
            if (!submitting) setSelectedAction(null);
          }}
          onSubmit={() => void submit()}
        />
      ) : null}
    </>
  );
}

function ProcessingModal({
  action,
  bundle,
  form,
  error,
  submitting,
  onSet,
  onClose,
  onSubmit
}: {
  action: InboxProcessingAction;
  bundle: InboxProcessingBundle;
  form: ProcessingForm;
  error: string;
  submitting: boolean;
  onSet: <K extends keyof ProcessingForm>(key: K, value: ProcessingForm[K]) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const actionConfig = actions.find((item) => item.action === action)!;
  const showsTaskDetails = ["do_now", "create_task", "assign", "schedule", "add_waiting"].includes(action);

  return (
    <Modal title={actionConfig.label} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label>
          <span className="label">名稱</span>
          <input
            className="field mt-2"
            value={form.title}
            maxLength={500}
            required
            autoFocus
            onChange={(event) => onSet("title", event.target.value)}
          />
        </label>

        <label>
          <span className="label">原始內容／補充</span>
          <textarea
            className="field mt-2 min-h-24"
            value={form.description}
            maxLength={10000}
            onChange={(event) => onSet("description", event.target.value)}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="label">範圍</span>
            <select
              className="field mt-2"
              value={form.area}
              onChange={(event) => onSet("area", event.target.value as ProcessingForm["area"])}
            >
              <option value="work">工作</option>
              <option value="family">家庭</option>
              <option value="personal">個人</option>
            </select>
          </label>
          {action !== "keep_note" ? (
            <label>
              <span className="label">日期／死線</span>
              <input
                className="field mt-2"
                type="date"
                value={form.dueDate}
                onChange={(event) => onSet("dueDate", event.target.value)}
              />
            </label>
          ) : null}
        </div>

        {showsTaskDetails ? (
          <>
            <label>
              <span className="label">下一個最小步驟{action === "do_now" ? "（必填）" : ""}</span>
              <input
                className="field mt-2"
                value={form.nextAction}
                maxLength={5000}
                required={action === "do_now"}
                placeholder="例如：打開文件，先寫第一行"
                onChange={(event) => onSet("nextAction", event.target.value)}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <label>
                <span className="label">預計分鐘</span>
                <input
                  className="field mt-2"
                  type="number"
                  min={0}
                  max={14400}
                  value={form.estimatedMinutes}
                  onChange={(event) => onSet("estimatedMinutes", event.target.value)}
                />
              </label>
              <label>
                <span className="label">能量</span>
                <select
                  className="field mt-2"
                  value={form.energyLevel}
                  onChange={(event) => onSet("energyLevel", event.target.value as ProcessingForm["energyLevel"])}
                >
                  <option value="">未指定</option>
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                </select>
              </label>
              <label>
                <span className="label">Context</span>
                <input
                  className="field mt-2"
                  value={form.context}
                  maxLength={500}
                  placeholder="電話／電腦／外出"
                  onChange={(event) => onSet("context", event.target.value)}
                />
              </label>
            </div>
          </>
        ) : null}

        {action === "schedule" ? (
          <label>
            <span className="label">安排日期（必填）</span>
            <input
              className="field mt-2"
              type="date"
              value={form.plannedDate}
              required
              onChange={(event) => onSet("plannedDate", event.target.value)}
            />
          </label>
        ) : null}

        {action === "assign" ? (
          <>
            <label>
              <span className="label">交給誰跟進</span>
              <select
                className="field mt-2"
                value={form.handoffToUserId}
                required
                onChange={(event) => onSet("handoffToUserId", event.target.value)}
              >
                <option value="">請選擇</option>
                {bundle.participants
                  .filter((participant) => participant.user_id !== bundle.currentUser.id)
                  .map((participant) => (
                    <option key={participant.user_id} value={participant.user_id}>
                      {participant.display_name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span className="label">交接 notes（必填）</span>
              <textarea
                className="field mt-2 min-h-24"
                value={form.handoffNote}
                maxLength={5000}
                required
                placeholder="簡單講明第一步、現況或要留意的資料"
                onChange={(event) => onSet("handoffNote", event.target.value)}
              />
            </label>
          </>
        ) : null}

        {error ? <InlineError message={error} /> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "處理中…" : `確認${actionConfig.label}`}
          </Button>
          <Button type="button" variant="secondary" disabled={submitting} onClick={onClose}>
            取消
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function emptyForm(item: OperatingItem | null): ProcessingForm {
  return {
    title: item?.title ?? "",
    description: item?.description ?? "",
    nextAction: item?.next_action ?? "",
    area: item?.area ?? "personal",
    estimatedMinutes: "",
    energyLevel: "",
    context: "",
    dueDate: item?.due_date ?? "",
    plannedDate: "",
    handoffToUserId: "",
    handoffNote: "",
    notes: ""
  };
}

function InlineError({ message }: { message: string }) {
  return (
    <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">
      {message}
    </p>
  );
}
