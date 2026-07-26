"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BatteryLow,
  CalendarClock,
  Check,
  ChevronDown,
  Clock3,
  Coffee,
  Plus,
  RefreshCw,
  Scissors,
  ShieldCheck,
  Sparkles,
  TimerReset,
  UserRoundCheck,
  Zap
} from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { AIDailyPlanner } from "@/components/AIDailyPlanner";
import { CapacityOverloadPanel } from "@/components/CapacityOverloadPanel";
import { FocusMode } from "@/components/FocusMode";
import { LoadingState } from "@/components/LoadingState";
import { Modal } from "@/components/Modal";
import { TaskForm } from "@/components/forms/TaskForm";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { assessCapacityOverload } from "@/lib/capacity-overload";
import { formatDate } from "@/lib/date";
import {
  activeWipCount,
  classifyDeadlineRisk,
  hkDateIso,
  recommendTodayTasks,
  suggestSmallerStep
} from "@/lib/planning";
import type {
  Assignment,
  CapacityCheckin,
  Task,
  TodayData,
  TodayPlanRole
} from "@/lib/types";
import { useTodayData } from "@/hooks/useTodayData";

type PlanItem = NonNullable<ReturnType<typeof recommendTodayTasks>["now"]>;

export default function HomePage() {
  return (
    <AuthGate>
      <TodayCommandCenter />
    </AuthGate>
  );
}

function TodayCommandCenter() {
  const { data, loading, error, reload } = useTodayData();
  const [adding, setAdding] = useState(false);
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const [focusMinutes, setFocusMinutes] = useState<number | null>(null);
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preference, setPreference] = useState<"balanced" | "easier">("balanced");
  const [excludedNowIds, setExcludedNowIds] = useState<string[]>([]);
  const [splitTask, setSplitTask] = useState<Task | null>(null);
  const [handoffTask, setHandoffTask] = useState<Task | null>(null);
  const [postponeTask, setPostponeTask] = useState<Task | null>(null);
  const confirmationToken = useRef<string | null>(null);

  const today = hkDateIso();
  const currentData = data;
  const isSuki = Boolean(currentData?.currentUser.displayName.toLowerCase().includes("suki"));
  const minimumDay = Boolean(
    currentData
    && (
      currentData.settings.gentle_mode
      || currentData.capacity?.mode === "gentle"
      || currentData.capacity?.mode === "minimum_step"
      || currentData.capacity?.essential_only
      || (isSuki && currentData.capacity?.energy_level === "low")
    )
  );
  const recommendation = useMemo(
    () => currentData
      ? recommendTodayTasks({
          tasks: currentData.tasks,
          assignments: currentData.assignments,
          currentUserId: currentData.currentUser.id,
          settings: currentData.settings,
          capacity: currentData.capacity,
          planning: currentData.planning,
          dependencies: currentData.taskDependencies,
          minimumDay,
          preference,
          excludeNowTaskIds: excludedNowIds,
          today
        })
      : null,
    [currentData, excludedNowIds, minimumDay, preference, today]
  );
  const overloadAssessment = useMemo(
    () => currentData ? assessCapacityOverload({
      tasks: currentData.tasks,
      assignments: currentData.assignments,
      planning: currentData.planning,
      currentUserId: currentData.currentUser.id,
      settings: currentData.settings,
      capacity: currentData.capacity,
      commitments: currentData.capacityCommitments,
      weeklyAvailableMinutes: currentData.weeklyAvailableMinutes,
      today
    }) : null,
    [currentData, today]
  );

  if (loading || error || !currentData || !recommendation) {
    return <LoadingState error={error} />;
  }
  const readyData: TodayData = currentData;
  const readyRecommendation: NonNullable<typeof recommendation> = recommendation;

  const acceptedPlan = acceptedTodayPlan(currentData, today);
  const hasAcceptedPlan = acceptedPlan.metadata.length > 0;
  const showPreview = previewing || !hasAcceptedPlan;
  const acceptedCoreCompleted = acceptedPlan.metadata.some((item) =>
    item.plan_role === "now"
    && currentData.tasks.some((task) => task.id === item.resource_id && task.status === "done")
  );
  const displayedNow = showPreview
    ? recommendation.now?.task ?? null
    : acceptedPlan.now?.status === "done"
      ? null
      : acceptedPlan.now;
  const displayedLater = showPreview ? recommendation.later.map((item) => item.task) : acceptedPlan.later;
  const displayedQuickWins = showPreview ? recommendation.quickWins.map((item) => item.task) : acceptedPlan.quickWins;
  const displayedNowItem = showPreview ? recommendation.now : displayedNow
    ? recommendation.all.find((item) => item.task.id === displayedNow.id) ?? fallbackPlanItem(displayedNow)
    : null;
  const acceptedAssignments = new Set(
    currentData.assignments
      .filter((item) =>
        item.assigned_to_id === currentData.currentUser.id
        && ["accepted", "in_progress"].includes(item.status)
      )
      .map((item) => item.resource_id)
  );
  const pending = currentData.assignments.filter((item) =>
    item.assigned_to_id === currentData.currentUser.id
    && item.status === "pending_acceptance"
  );
  const wip = activeWipCount(
    currentData.tasks,
    currentData.assignments,
    currentData.currentUser.id
  );
  const wipLimit = currentData.settings.wip_limit ?? 3;
  const handoffTarget = currentData.participants.find(
    (participant) => participant.user_id !== currentData.currentUser.id
  );

  function openFocus(task: Task, minutes?: number) {
    setFocusTask(task);
    setFocusMinutes(minutes ?? null);
  }

  function resetPlanToken() {
    confirmationToken.current = null;
  }

  function requestReplan() {
    setPreviewing(true);
    setPreference("balanced");
    setExcludedNowIds(displayedNow ? [displayedNow.id] : []);
    resetPlanToken();
    setActionMessage("已重新計算另一個不超出今日容量的建議；確認前不會改動任務。");
  }

  function requestEasierPlan() {
    setPreviewing(true);
    setPreference("easier");
    setExcludedNowIds([]);
    resetPlanToken();
    setActionMessage("已改用較短、較低阻力的建議。");
  }

  function switchNowTask() {
    if (!readyRecommendation.now) return;
    setPreviewing(true);
    setExcludedNowIds((current) => [...new Set([...current, readyRecommendation.now!.task.id])]);
    resetPlanToken();
    setActionMessage("已換一項建議；原任務沒有被延期或修改。");
  }

  async function acceptPlan() {
    const selection = [
      ...(readyRecommendation.now ? [{ taskId: readyRecommendation.now.task.id, role: "now" as const }] : []),
      ...readyRecommendation.later.map((item) => ({ taskId: item.task.id, role: "later" as const })),
      ...readyRecommendation.quickWins.map((item) => ({ taskId: item.task.id, role: "quick_win" as const }))
    ];
    if (!selection.length || busy) return;
    setBusy(true);
    setActionError("");
    setActionMessage("");
    try {
      confirmationToken.current ??= crypto.randomUUID();
      await controlAction("accept_today_plan", {
        taskIds: selection.map((item) => item.taskId),
        roles: selection.map((item) => item.role),
        planDate: today,
        idempotencyKey: confirmationToken.current
      });
      await reload();
      setPreviewing(false);
      setPreference("balanced");
      setExcludedNowIds([]);
      resetPlanToken();
      setActionMessage("今日安排已確認。只有你剛才確認的建議已加入 Today。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "未能確認今日安排。");
    } finally {
      setBusy(false);
    }
  }

  async function respond(assignment: Assignment, response: "accept" | "decline") {
    setActionError("");
    try {
      await controlAction("assignment_response", {
        id: assignment.id,
        response,
        reason: response === "decline" ? "日期或容量不合適" : undefined
      });
      await reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "未能處理指派。");
    }
  }

  async function complete(task: Task) {
    setActionError("");
    try {
      await controlAction("update_task", { id: task.id, changes: { status: "done" } });
      await reload();
      setActionMessage(minimumDay ? "今日核心責任已完成。" : "任務已完成。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "未能完成任務。");
    }
  }

  async function setRestDay(restDay: boolean) {
    setBusy(true);
    setActionError("");
    try {
      await controlAction("capacity_checkin", {
        energyLevel: readyData.capacity?.energy_level ?? "low",
        availableMinutes: readyData.capacity?.available_minutes,
        mode: restDay ? "minimum_step" : readyData.capacity?.mode ?? "normal",
        essentialOnly: restDay || readyData.capacity?.essential_only,
        restDay,
        notes: restDay ? "今日選擇休息；沒有自動移動任何任務。" : readyData.capacity?.notes
      });
      await reload();
      setActionMessage(restDay ? "今日已設為休息。所有任務保持原狀。" : "今日行動已重新開啟。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "未能更新今日狀態。");
    } finally {
      setBusy(false);
    }
  }

  if (currentData.capacity?.rest_day) {
    return (
      <div className="space-y-5">
        <TodayHeader
          minimumDay
          onCapacity={() => setCapacityOpen(true)}
          onAdd={() => setAdding(true)}
        />
        <section className="panel mx-auto max-w-2xl p-6 text-center sm:p-9">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Coffee className="h-7 w-7" />
          </div>
          <p className="eyebrow mt-5">Minimum Viable Day</p>
          <h2 className="mt-2 text-2xl font-extrabold text-slate-900">今日休息已安排</h2>
          <p className="muted mx-auto mt-3 max-w-lg leading-7">
            休息唔係失敗。系統沒有完成、延期或搬動任何任務，亦不會製造負面紀錄。
          </p>
          <Button className="mt-6" disabled={busy} onClick={() => void setRestDay(false)}>
            <ArrowRight className="h-5 w-5" />
            需要時重新開啟今日
          </Button>
          {actionError ? <InlineAlert message={actionError} /> : null}
        </section>
        {capacityOpen ? (
          <CapacityModal
            current={currentData.capacity}
            onClose={() => setCapacityOpen(false)}
            onSaved={() => {
              setCapacityOpen(false);
              void reload();
            }}
          />
        ) : null}
        {adding ? (
          <Modal title="快速新增任務" onClose={() => setAdding(false)}>
            <TaskForm
              userId={currentData.currentUser.id}
              participants={currentData.participants}
              compact
              onSaved={() => {
                setAdding(false);
                void reload();
              }}
              onCancel={() => setAdding(false)}
            />
          </Modal>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <TodayHeader
        minimumDay={minimumDay}
        onCapacity={() => setCapacityOpen(true)}
        onAdd={() => setAdding(true)}
      />

      {actionMessage ? (
        <p className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm font-semibold text-indigo-800" role="status">
          {actionMessage}
        </p>
      ) : null}
      {actionError ? <InlineAlert message={actionError} /> : null}

      <AIDailyPlanner
        date={today}
        capacity={currentData.capacity}
        settings={currentData.settings}
        tasks={currentData.tasks}
        onAccepted={reload}
      />

      {minimumDay && acceptedCoreCompleted ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5" role="status">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-emerald-700">
              <Check className="h-6 w-6" />
            </div>
            <div>
              <p className="text-lg font-extrabold text-emerald-900">今日核心責任已完成</p>
              <p className="mt-1 text-sm leading-6 text-emerald-800">
                額外小任務全部都係可選；今日停喺呢度亦可以。
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {showPreview ? (
        <details className="panel group overflow-hidden">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
            <span>
              <span className="block text-sm font-extrabold text-slate-900">規則式安全建議</span>
              <span className="mt-1 block text-xs text-slate-500">每日安排使用免費規則引擎；需要深度拆解時，任務卡可一鍵開啟 ChatGPT。</span>
            </span>
            <ChevronDown className="h-5 w-5 text-slate-400 transition group-open:rotate-180" />
          </summary>
          <div className="border-t border-slate-100 p-4">
            <PlanPreviewSummary
              plan={recommendation}
              minimumDay={minimumDay}
              busy={busy}
              onAccept={() => void acceptPlan()}
              onReplan={requestReplan}
              onEasier={requestEasierPlan}
            />
          </div>
        </details>
      ) : (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <p className="text-sm font-bold text-slate-900">已確認的今日安排</p>
            <p className="muted mt-1 text-sm">重新安排只會在你再次確認後取代上一次 Auto‑Plan。</p>
          </div>
          <Button variant="secondary" onClick={requestReplan}>
            <RefreshCw className="h-4 w-4" />
            重新安排
          </Button>
        </section>
      )}

      {overloadAssessment ? (
        <CapacityOverloadPanel
          assessment={overloadAssessment}
          handoffTargetName={handoffTarget?.display_name}
          onPostpone={setPostponeTask}
          onHandoff={setHandoffTask}
        />
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,.7fr)]">
        <div className="relative overflow-hidden rounded-2xl border border-indigo-200 bg-white p-5 sm:p-7">
          <div className="pointer-events-none absolute right-[-3rem] top-[-5rem] h-56 w-56 rounded-full bg-indigo-100/70 blur-2xl" />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-bold text-indigo-700">
                <Sparkles className="h-4 w-4" />
                {showPreview ? "建議：現在做" : minimumDay ? "今日核心最低任務" : "現在做"}
              </div>
              {displayedNowItem ? (
                <RiskPill risk={displayedNowItem.risk} gentle={minimumDay} />
              ) : null}
            </div>
            {minimumDay && acceptedCoreCompleted && !showPreview ? (
              <div className="py-8 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                  <Check className="h-6 w-6" />
                </div>
                <h2 className="mt-4 text-xl font-extrabold text-slate-900">核心最低任務已完成</h2>
                <p className="muted mx-auto mt-2 max-w-md text-sm leading-6">
                  今日可以停喺呢度；下方額外任務全部可選。
                </p>
              </div>
            ) : displayedNow && displayedNowItem ? (
              <PrimaryTask
                item={displayedNowItem}
                assigned={acceptedAssignments.has(displayedNow.id)}
                preview={showPreview}
                minimumDay={minimumDay}
                onFocus={() => openFocus(displayedNow)}
                onComplete={() => void complete(displayedNow)}
                onPostpone={() => setPostponeTask(displayedNow)}
                onSplit={() => setSplitTask(displayedNow)}
                onSwitch={switchNowTask}
              />
            ) : (
              <EmptyState
                title={recommendation.wipLimitReached ? "先收窄進行中的工作" : "今日容量內暫時沒有合適任務"}
                text={recommendation.wipLimitReached
                  ? "WIP 已達上限；完成或暫停一項後，系統先會建議開新工作。"
                  : "可以調整今日容量，或新增一個 5–15 分鐘的清晰下一步。"}
                onAdd={() => setAdding(true)}
              />
            )}
            {minimumDay && displayedNow && !showPreview ? (
              <MinimumDayActions
                canHandoff={Boolean(handoffTarget)}
                handoffTargetName={handoffTarget?.display_name}
                onRest={() => void setRestDay(true)}
                onEasier={requestEasierPlan}
                onFirstStep={() => setSplitTask(displayedNow)}
                onHandoff={() => setHandoffTask(displayedNow)}
                onPostpone={() => setPostponeTask(displayedNow)}
              />
            ) : null}
          </div>
        </div>

        <CapacityCard
          capacity={currentData.capacity}
          minimumDay={minimumDay}
          plan={recommendation}
          wip={wip}
          wipLimit={wipLimit}
        />
      </section>

      {!minimumDay && pending.length ? (
        <section className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Pending Assignments</p>
              <h2 className="section-title mt-1">等待你回應</h2>
            </div>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-bold text-indigo-700">
              {pending.length}
            </span>
          </div>
          <div className="mt-4 grid gap-3">
            {pending.map((assignment) => (
              <PendingAssignment
                key={assignment.id}
                assignment={assignment}
                task={currentData.tasks.find((task) => task.id === assignment.resource_id)}
                actor={participantName(currentData, assignment.assigned_by_id)}
                onAccept={() => void respond(assignment, "accept")}
                onDecline={() => void respond(assignment, "decline")}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className={`grid gap-4 ${minimumDay ? "lg:grid-cols-1" : "lg:grid-cols-2"}`}>
        {!minimumDay ? (
          <TaskListPanel
            eyebrow="Later Today"
            title="今日之後做"
            tasks={displayedLater}
            empty="今日容量內沒有其他必要事項。"
            onFocus={openFocus}
          />
        ) : null}
        <TaskListPanel
          eyebrow="Quick Wins"
          title={minimumDay ? "可選的簡單額外任務" : "低阻力小任務"}
          tasks={displayedQuickWins}
          empty={minimumDay
            ? "今日只做核心任務已經足夠。"
            : "加入預計時間後，系統會在這裡顯示 Quick Wins。"}
          onFocus={openFocus}
        />
      </section>

      {minimumDay && pending.length ? (
        <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-600">
          其他交接事項仍然保留，可在「Derek／Suki Handover」稍後查看；今日畫面暫不顯示 backlog。
        </p>
      ) : null}

      {adding ? (
        <Modal title="快速新增任務" onClose={() => setAdding(false)}>
          <TaskForm
            userId={currentData.currentUser.id}
            participants={currentData.participants}
            compact
            onSaved={() => {
              setAdding(false);
              void reload();
            }}
            onCancel={() => setAdding(false)}
          />
        </Modal>
      ) : null}
      {capacityOpen ? (
        <CapacityModal
          current={currentData.capacity}
          onClose={() => setCapacityOpen(false)}
          onSaved={() => {
            setCapacityOpen(false);
            resetPlanToken();
            void reload();
          }}
        />
      ) : null}
      {splitTask ? (
        <SplitStepModal
          task={splitTask}
          onClose={() => setSplitTask(null)}
          onStart={(minutes) => {
            const task = splitTask;
            setSplitTask(null);
            openFocus(task, minutes);
          }}
        />
      ) : null}
      {handoffTask && handoffTarget ? (
        <HandoffModal
          task={handoffTask}
          target={handoffTarget}
          onClose={() => setHandoffTask(null)}
          onSaved={() => {
            setHandoffTask(null);
            void reload();
          }}
        />
      ) : null}
      {postponeTask ? (
        <PostponeModal
          task={postponeTask}
          onClose={() => setPostponeTask(null)}
          onSaved={() => {
            setPostponeTask(null);
            void reload();
          }}
        />
      ) : null}
      {focusTask ? (
        <FocusMode
          task={focusTask}
          defaultMinutes={focusMinutes ?? currentData.settings.focus_minutes ?? 25}
          participants={currentData.participants}
          currentUserId={currentData.currentUser.id}
          sharedTask={
            focusTask.visibility !== "private"
            || currentData.shares.some((share) =>
              share.resource_type === "task"
              && share.resource_id === focusTask.id
              && !share.revoked_at
            )
          }
          onClose={() => {
            setFocusTask(null);
            setFocusMinutes(null);
          }}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}

function TodayHeader({
  minimumDay,
  onCapacity,
  onAdd
}: {
  minimumDay: boolean;
  onCapacity: () => void;
  onAdd: () => void;
}) {
  return (
    <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow">Today Command Center</p>
        <h1 className="page-title mt-1">
          {minimumDay ? "今日只需要推進最小一步" : "今日行動中心"}
        </h1>
        <p className="muted mt-2 max-w-2xl text-sm leading-6">
          {minimumDay
            ? "只顯示一項核心責任及最多兩項簡單選項；休息亦是有效安排。"
            : "系統先提出容量內的次序，你確認後才會加入 Today。"}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onCapacity}>
          <BatteryLow className="h-5 w-5" />
          今日容量
        </Button>
        <Button onClick={onAdd}>
          <Plus className="h-5 w-5" />
          快速新增
        </Button>
      </div>
    </section>
  );
}

function PlanPreviewSummary({
  plan,
  minimumDay,
  busy,
  onAccept,
  onReplan,
  onEasier
}: {
  plan: ReturnType<typeof recommendTodayTasks>;
  minimumDay: boolean;
  busy: boolean;
  onAccept: () => void;
  onReplan: () => void;
  onEasier: () => void;
}) {
  const count = (plan.now ? 1 : 0) + plan.later.length + plan.quickWins.length;
  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-700" />
            <h2 className="font-extrabold text-slate-900">Auto‑Plan 預覽</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            建議 {count} 項 · 工作 {plan.estimatedTotalMinutes} 分鐘 ·
            預留 buffer {plan.bufferMinutes} 分鐘 · 今日容量 {plan.availableMinutes} 分鐘
          </p>
          {plan.hasCapacityOverflow ? (
            <p className="mt-1 text-sm font-semibold text-amber-800">
              {minimumDay
                ? "其餘工作不會塞入今日；今日只保留最低限度。"
                : `另有 ${plan.unplannedCount} 項超出今日容量，未有自動加入。`}
            </p>
          ) : null}
          {plan.excludedBlocked ? (
            <p className="mt-1 text-xs text-slate-600">
              {plan.excludedBlocked} 項等待／被阻塞任務已排除；尚待前置步驟的任務亦不會成為 Now。
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || count === 0} onClick={onAccept}>
            <Check className="h-4 w-4" />
            {busy ? "確認中…" : "確認加入 Today"}
          </Button>
          <Button variant="secondary" onClick={onReplan}>
            <RefreshCw className="h-4 w-4" />
            重新安排
          </Button>
          <Button variant="secondary" onClick={onEasier}>
            <BatteryLow className="h-4 w-4" />
            太難
          </Button>
        </div>
      </div>
    </section>
  );
}

function PrimaryTask({
  item,
  assigned,
  preview,
  minimumDay,
  onFocus,
  onComplete,
  onPostpone,
  onSplit,
  onSwitch
}: {
  item: PlanItem;
  assigned: boolean;
  preview: boolean;
  minimumDay: boolean;
  onFocus: () => void;
  onComplete: () => void;
  onPostpone: () => void;
  onSplit: () => void;
  onSwitch: () => void;
}) {
  const task = item.task;
  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
          {areaLabel[task.area ?? (task.scope === "company" ? "work" : "family")]}
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
          {assigned ? "已接受指派" : "由你跟進"}
        </span>
        {preview ? (
          <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">
            尚未加入 Today
          </span>
        ) : null}
      </div>
      <h2 className="mt-4 text-2xl font-bold leading-tight tracking-tight sm:text-4xl">
        {task.title}
      </h2>
      <div className="mt-5 rounded-xl bg-slate-50 p-4">
        <p className="text-xs font-bold uppercase tracking-[.12em] text-slate-500">
          {minimumDay ? "最低完成標準" : "下一步"}
        </p>
        <p className="mt-2 text-base font-semibold leading-7 sm:text-lg">
          {task.next_action || "先打開需要的頁面，寫下一個可見的第一步"}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
        <span className="flex items-center gap-1.5">
          <Clock3 className="h-4 w-4" />
          {item.minutes} 分鐘
        </span>
        {task.due_date ? (
          <span className="flex items-center gap-1.5">
            <CalendarClock className="h-4 w-4" />
            截止 {formatDate(task.due_date)}
          </span>
        ) : null}
        <span>推薦原因：{item.reasons.slice(0, 2).join("、")}</span>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {preview ? (
          <>
            <Button variant="secondary" onClick={onSwitch}>
              <RefreshCw className="h-4 w-4" />
              換一件
            </Button>
            <Button variant="secondary" onClick={onSplit}>
              <Scissors className="h-4 w-4" />
              拆細一點
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onFocus}>
              <ArrowRight className="h-5 w-5" />
              從這一步開始
            </Button>
            <Button variant="success" onClick={onComplete}>
              <Check className="h-5 w-5" />
              完成
            </Button>
            {!minimumDay ? (
              <Button variant="secondary" onClick={onPostpone}>
                <TimerReset className="h-5 w-5" />
                延至指定日
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function MinimumDayActions({
  canHandoff,
  handoffTargetName,
  onRest,
  onEasier,
  onFirstStep,
  onHandoff,
  onPostpone
}: {
  canHandoff: boolean;
  handoffTargetName?: string;
  onRest: () => void;
  onEasier: () => void;
  onFirstStep: () => void;
  onHandoff: () => void;
  onPostpone: () => void;
}) {
  return (
    <div className="mt-6 border-t border-slate-100 pt-5">
      <p className="text-sm font-bold text-slate-800">今日需要更輕一點？</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" onClick={onRest}>
          <Coffee className="h-4 w-4" />
          今日休息
        </Button>
        <Button variant="secondary" onClick={onEasier}>
          <BatteryLow className="h-4 w-4" />
          改做更簡單
        </Button>
        <Button variant="secondary" onClick={onFirstStep}>
          <Scissors className="h-4 w-4" />
          只完成第一步
        </Button>
        <Button variant="secondary" disabled={!canHandoff} onClick={onHandoff}>
          <UserRoundCheck className="h-4 w-4" />
          請 {handoffTargetName || "對方"} 接手
        </Button>
        <Button className="sm:col-span-2" variant="secondary" onClick={onPostpone}>
          <TimerReset className="h-4 w-4" />
          延至指定日
        </Button>
      </div>
    </div>
  );
}

function CapacityCard({
  capacity,
  minimumDay,
  plan,
  wip,
  wipLimit
}: {
  capacity: CapacityCheckin | null;
  minimumDay: boolean;
  plan: ReturnType<typeof recommendTodayTasks>;
  wip: number;
  wipLimit: number;
}) {
  return (
    <aside className="panel p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow">工作容量</p>
          <h2 className="section-title mt-1">進行中 {wip} / {wipLimit}</h2>
        </div>
        <div className={`grid h-11 w-11 place-items-center rounded-xl ${
          wip > wipLimit ? "bg-amber-100 text-amber-700" : "bg-emerald-50 text-emerald-700"
        }`}>
          {wip > wipLimit ? <AlertTriangle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${wip > wipLimit ? "bg-amber-500" : "bg-indigo-500"}`}
          style={{ width: `${Math.min(100, (wip / Math.max(1, wipLimit)) * 100)}%` }}
        />
      </div>
      <p className="muted mt-3 text-sm leading-6">
        {plan.wipLimitReached
          ? "WIP 已滿，Auto‑Plan 只會考慮已開始的工作。"
          : minimumDay
            ? "容量可以隨時再調低，不會視為失敗。"
            : "排序已計入 WIP、能量、限期、影響及可用時間。"}
      </p>
      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
        <p className="font-semibold">
          今日能量：{capacity ? energyLabel[capacity.energy_level] : "未設定"}
        </p>
        <p className="muted mt-1">
          {capacity?.available_minutes !== null && capacity?.available_minutes !== undefined
            ? `可用 ${capacity.available_minutes} 分鐘`
            : `未設定時間；暫以 ${plan.availableMinutes} 分鐘建議`}
        </p>
        <p className="muted mt-1">已預留 {plan.bufferMinutes} 分鐘 buffer</p>
      </div>
    </aside>
  );
}

function TaskListPanel({
  eyebrow,
  title,
  tasks,
  empty,
  onFocus
}: {
  eyebrow: string;
  title: string;
  tasks: Task[];
  empty: string;
  onFocus: (task: Task) => void;
}) {
  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="section-title mt-1">{title}</h2>
        </div>
        {eyebrow === "Quick Wins" ? <Zap className="h-5 w-5 text-amber-500" /> : null}
      </div>
      <div className="mt-4 space-y-3">
        {tasks.length ? tasks.map((task) => (
          <CompactTask key={task.id} task={task} onFocus={() => onFocus(task)} />
        )) : (
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{empty}</p>
        )}
      </div>
    </div>
  );
}

function CompactTask({ task, onFocus }: { task: Task; onFocus: () => void }) {
  const completed = task.status === "done";
  return (
    <button
      className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      disabled={completed}
      onClick={completed ? undefined : onFocus}
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
        {completed ? <Check className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-slate-900">{task.title}</p>
        <p className="mt-1 truncate text-xs text-slate-500">
          {task.next_action || `${task.estimated_minutes ?? 15} 分鐘 · ${task.context || "任何地方"}`}
        </p>
      </div>
      {task.due_date ? (
        <span className="shrink-0 text-xs font-semibold text-slate-500">
          {formatDate(task.due_date).slice(5)}
        </span>
      ) : null}
    </button>
  );
}

function PendingAssignment({
  assignment,
  task,
  actor,
  onAccept,
  onDecline
}: {
  assignment: Assignment;
  task?: Task;
  actor: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-indigo-700">由 {actor} 指派 · 可更新狀態</p>
        <h3 className="mt-1 font-bold">{task?.title || "一項已分享工作"}</h3>
        <p className="muted mt-1 text-sm">
          {assignment.due_date ? `截止 ${formatDate(assignment.due_date)}` : "未設定截止日期"}
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={onAccept}>接受</Button>
        <Button variant="secondary" onClick={onDecline}>婉拒</Button>
      </div>
    </article>
  );
}

function RiskPill({
  risk,
  gentle
}: {
  risk: ReturnType<typeof classifyDeadlineRisk>;
  gentle: boolean;
}) {
  const map = {
    normal: "正常",
    attention: "需要留意",
    high_risk: gentle ? "適合先做最小一步" : "已到安全開始時間",
    overdue: gentle ? "可以重新安排" : "限期需要處理",
    waiting_external: "等待外部回覆"
  };
  const tone = risk === "normal" || risk === "waiting_external"
    ? "bg-slate-100 text-slate-600"
    : "bg-amber-50 text-amber-800";
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${tone}`}>{map[risk]}</span>;
}

function EmptyState({
  title,
  text,
  onAdd
}: {
  title: string;
  text: string;
  onAdd: () => void;
}) {
  return (
    <div className="py-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600">
        <Sparkles className="h-5 w-5" />
      </div>
      <h2 className="mt-4 text-xl font-bold">{title}</h2>
      <p className="muted mx-auto mt-2 max-w-md text-sm leading-6">{text}</p>
      <Button className="mt-5" onClick={onAdd}>
        <Plus className="h-5 w-5" />
        新增任務
      </Button>
    </div>
  );
}

function CapacityModal({
  current,
  onClose,
  onSaved
}: {
  current: CapacityCheckin | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [energy, setEnergy] = useState(current?.energy_level ?? "medium");
  const [minutes, setMinutes] = useState(String(current?.available_minutes ?? ""));
  const [mode, setMode] = useState(current?.mode ?? "normal");
  const [essentialOnly, setEssentialOnly] = useState(current?.essential_only ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await controlAction("capacity_checkin", {
        energyLevel: energy,
        availableMinutes: minutes ? Number(minutes) : null,
        mode,
        essentialOnly,
        restDay: false
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能儲存今日容量。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="今日容量" onClose={onClose}>
      <form className="grid gap-4" onSubmit={save}>
        <fieldset>
          <legend className="label">今日能量</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(["low", "medium", "high"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`min-h-11 rounded-xl border px-3 font-semibold ${
                  energy === value ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200"
                }`}
                onClick={() => setEnergy(value)}
              >
                {energyLabel[value]}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          <span className="label">今日可用時間（分鐘）</span>
          <input
            className="field mt-2"
            type="number"
            min="0"
            max="1440"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
        <label>
          <span className="label">今日模式</span>
          <select
            className="field mt-2"
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="normal">一般</option>
            <option value="gentle">Gentle Mode</option>
            <option value="minimum_step">只做最小下一步</option>
            <option value="shift">更表模式</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 p-3">
          <input
            type="checkbox"
            checked={essentialOnly}
            onChange={(event) => setEssentialOnly(event.target.checked)}
          />
          <span className="font-semibold">今日只顯示必要事項</span>
        </label>
        {error ? <InlineAlert message={error} /> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "儲存中…" : "儲存今日容量"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        </div>
      </form>
    </Modal>
  );
}

function SplitStepModal({
  task,
  onClose,
  onStart
}: {
  task: Task;
  onClose: () => void;
  onStart: (minutes: number) => void;
}) {
  const suggestion = suggestSmallerStep(task);
  return (
    <Modal title="拆細一點" onClose={onClose}>
      <div className="rounded-xl bg-indigo-50 p-4">
        <p className="text-xs font-bold uppercase tracking-[.12em] text-indigo-700">建議 10 分鐘第一步</p>
        <p className="mt-2 text-lg font-bold leading-7 text-slate-900">{suggestion.text}</p>
      </div>
      <p className="muted mt-4 text-sm leading-6">
        呢個只係建議；開始 Focus 不會把整項任務標示為完成。
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => onStart(suggestion.minutes)}>
          <ArrowRight className="h-4 w-4" />
          用 10 分鐘開始
        </Button>
        <Button variant="secondary" onClick={onClose}>保留原任務</Button>
      </div>
    </Modal>
  );
}

function HandoffModal({
  task,
  target,
  onClose,
  onSaved
}: {
  task: Task;
  target: { user_id: string; display_name: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState(
    task.next_action
      ? `我今日能量較低，請先接手：${task.next_action}`
      : "我今日能量較低，請先幫我睇第一步。"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await controlAction("handoff_task", {
        taskId: task.id,
        targetUserId: target.user_id,
        note,
        dueDate: task.due_date
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能交接任務。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`請 ${target.display_name} 接手`} onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <p className="rounded-xl bg-slate-50 p-4 font-semibold">{task.title}</p>
        <label>
          <span className="label">交接 notes</span>
          <textarea
            className="field mt-2 min-h-28"
            required
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        {error ? <InlineAlert message={error} /> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving || !note.trim()}>
            {saving ? "交接中…" : "確認交接"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        </div>
      </form>
    </Modal>
  );
}

function PostponeModal({
  task,
  onClose,
  onSaved
}: {
  task: Task;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tomorrow = addDaysToIso(hkDateIso(), 1);
  const [date, setDate] = useState(tomorrow);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await controlAction("snooze_today_task", { taskId: task.id, untilDate: date });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能安排日期。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="延至指定日" onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <p className="rounded-xl bg-slate-50 p-4 font-semibold">{task.title}</p>
        <label>
          <span className="label">下次再建議日期</span>
          <input
            className="field mt-2"
            type="date"
            min={tomorrow}
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <p className="muted text-sm">只會暫停你自己的 Today 建議，不會改動對方的安排。</p>
        {error ? <InlineAlert message={error} /> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>{saving ? "儲存中…" : "確認日期"}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        </div>
      </form>
    </Modal>
  );
}

function InlineAlert({ message }: { message: string }) {
  return (
    <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">
      {message}
    </p>
  );
}

function acceptedTodayPlan(data: TodayData, today: string) {
  const metadata = data.planning.filter((item) =>
    item.resource_type === "task"
    && item.planned_date === today
    && Boolean(item.plan_role)
  );
  const taskFor = (role: TodayPlanRole) => metadata
    .filter((item) => item.plan_role === role)
    .map((item) => data.tasks.find((task) => task.id === item.resource_id))
    .filter((task): task is Task => Boolean(task))
    .filter((task) =>
      !["blocked", "waiting", "cancelled"].includes(task.status)
      && !task.blocked_reason?.trim()
    );
  return {
    metadata,
    now: taskFor("now")[0] ?? null,
    later: taskFor("later"),
    quickWins: taskFor("quick_win")
  };
}

function fallbackPlanItem(task: Task): PlanItem {
  return {
    task,
    score: 0,
    risk: classifyDeadlineRisk({
      dueDate: task.due_date,
      latestSafeStartDate: task.latest_safe_start_date,
      status: task.status
    }),
    minutes: task.estimated_minutes ?? 25,
    reasons: ["已確認加入今日"]
  };
}

const areaLabel = { work: "工作", family: "家庭", personal: "個人" } as const;
const energyLabel = { low: "低", medium: "中", high: "高" } as const;

function participantName(data: TodayData, id: string) {
  return data.participants.find((item) => item.user_id === id)?.display_name || "對方";
}

function addDaysToIso(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
