"use client";

import Link from "next/link";
import { BellOff, CircleDollarSign, Mic, Plus, ShieldCheck, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatCurrency, formatDate, isOverdue } from "@/lib/date";
import { riskLabels, taskStatusDetailLabels } from "@/lib/labels";
import { resolveWorkspaceRole, roleTaskLabel, workspaceRoleLabels } from "@/lib/workspace-role";
import type { Assignment, Task, TodayData } from "@/lib/types";

export function RoleDailyDashboard({
  data,
  topTasks,
  busy,
  onVoice,
  onAdd,
  onQuietMode,
  onResolveDecision
}: {
  data: TodayData;
  topTasks: Task[];
  busy: boolean;
  onVoice: () => void;
  onAdd: () => void;
  onQuietMode: (until: string | null) => Promise<void>;
  onResolveDecision: (task: Task) => Promise<void>;
}) {
  const role = resolveWorkspaceRole({
    configured: data.profile.workspace_role,
    email: data.currentUser.email,
    displayName: data.currentUser.displayName
  });
  const visibleTop = uniqueTasks(topTasks).filter(activeTask).slice(0, 3);
  const urgent = data.taskCatalog
    .filter((task) => activeTask(task) && (task.risk === "high" || isOverdue(task.due_date)))
    .filter((task) => !visibleTop.some((top) => top.id === task.id))
    .slice(0, 3);
  const pending = data.assignments
    .filter((assignment) => assignment.assigned_to_id === data.currentUser.id && assignment.status === "pending_acceptance")
    .slice(0, 3);
  const decisions = data.taskCatalog
    .filter((task) => task.needs_decision_from_id === data.currentUser.id && !task.decision_resolved_at && activeTask(task))
    .slice(0, 3);
  const quietUntil = data.notificationPreferences?.quiet_mode_until ?? null;
  const quietActive = Boolean(quietUntil && new Date(quietUntil).getTime() > Date.now());
  const roleCounts = roleCategoryCounts(role, data.taskCatalog);

  return (
    <section className="space-y-4" aria-label={workspaceRoleLabels[role]}>
      <div className="overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50 p-5 shadow-soft sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="eyebrow">{workspaceRoleLabels[role]}</p>
            <h2 className="mt-1 text-2xl font-extrabold text-slate-950">今日只先處理最重要的三件事</h2>
            {roleCounts.length ? <p className="mt-2 text-sm text-slate-600">{roleCounts.join(" · ")}</p> : null}
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2">
            <Button type="button" className="min-h-14" onClick={onVoice}><Mic className="h-5 w-5" />語音交接</Button>
            <Button type="button" className="min-h-14" variant="secondary" onClick={onAdd}><Plus className="h-5 w-5" />新增任務</Button>
          </div>
        </div>
        {role === "derek" && data.cashflowHint ? (
          <Link href="/cashflow" className="mt-4 flex min-h-12 items-center gap-3 rounded-xl bg-white/85 px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200 hover:bg-white">
            <CircleDollarSign className="h-5 w-5 text-emerald-700" />
            <span><strong>本月簡潔現金流：</strong>已收 {formatCurrency(data.cashflowHint.receivedIncome)} · 未付 {formatCurrency(data.cashflowHint.unpaidExpenses)} · 預計結餘 {formatCurrency(data.cashflowHint.projectedBalance)}</span>
          </Link>
        ) : null}
      </div>

      <DashboardSection title="今日三項主要任務" count={visibleTop.length} empty="今日暫時沒有需要開始的主要任務。">
        {visibleTop.map((task) => <CompactTaskCard key={task.id} task={task} data={data} roleLabel={roleTaskLabel(role, task)} />)}
      </DashboardSection>

      {urgent.length ? (
        <DashboardSection title="真正緊急或已逾期" count={urgent.length} tone="urgent">
          {urgent.map((task) => <CompactTaskCard key={task.id} task={task} data={data} roleLabel={isOverdue(task.due_date) ? "需要重新安排" : "高風險／緊急"} />)}
        </DashboardSection>
      ) : null}

      {pending.length ? (
        <DashboardSection title="新交接" count={pending.length}>
          {pending.map((assignment) => <PendingHandoff key={assignment.id} assignment={assignment} task={data.taskCatalog.find((task) => task.id === assignment.resource_id)} />)}
          <Link className="inline-flex min-h-11 items-center font-bold text-indigo-700" href="/handover">查看及回應全部交接 →</Link>
        </DashboardSection>
      ) : null}

      {decisions.length ? (
        <DashboardSection title="等待本人決定或確認" count={decisions.length}>
          {decisions.map((task) => (
            <div key={task.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><p className="font-extrabold text-slate-950">{task.title}</p><p className="mt-1 text-sm text-slate-600">{task.case_code ? `個案 ${task.case_code} · ` : ""}{task.next_action || "請先查看完整內容"}</p></div>
                <div className="flex shrink-0 gap-2"><Link className="inline-flex min-h-11 items-center rounded-lg bg-white px-4 font-semibold text-slate-800 ring-1 ring-slate-200" href={`/tasks/${task.id}`}>查看</Link><Button type="button" disabled={busy} onClick={() => void onResolveDecision(task)}><ShieldCheck className="h-4 w-4" />確認決定</Button></div>
              </div>
            </div>
          ))}
        </DashboardSection>
      ) : null}

      {role === "suki" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex items-start gap-3"><BellOff className="mt-0.5 h-5 w-5 text-indigo-600" /><div><h3 className="font-extrabold text-slate-950">安靜模式</h3><p className="mt-1 text-sm text-slate-600">非緊急通知會合併留待稍後；不影響資料或其他人的工作。</p></div></div>
          <div className="mt-4 flex flex-wrap gap-2">
            {quietActive ? <Button type="button" variant="secondary" disabled={busy} onClick={() => void onQuietMode(null)}>現在恢復通知</Button> : <><Button type="button" variant="secondary" disabled={busy} onClick={() => void onQuietMode(new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString())}>安靜 2 小時</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => void onQuietMode(tomorrowAtNine())}>安靜至明早 9 點</Button></>}
          </div>
          {quietActive ? <p className="mt-3 text-sm font-semibold text-indigo-800">安靜模式已開啟，預計 {new Date(quietUntil!).toLocaleString("zh-HK")} 恢復。</p> : null}
        </section>
      ) : null}
    </section>
  );
}

function DashboardSection({ title, count, empty, tone = "normal", children }: { title: string; count: number; empty?: string; tone?: "normal" | "urgent"; children: React.ReactNode }) {
  return <section className={`rounded-2xl border p-4 sm:p-5 ${tone === "urgent" ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"}`}><div className="flex items-center justify-between gap-3"><h3 className="text-lg font-extrabold text-slate-950">{title}</h3><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-700">{count}</span></div><div className="mt-3 grid gap-3">{count ? children : <p className="py-2 text-sm text-slate-500">{empty}</p>}</div></section>;
}

function CompactTaskCard({ task, data, roleLabel }: { task: Task; data: TodayData; roleLabel: string }) {
  const ownerId = task.assignee_id ?? task.owner_id ?? data.currentUser.id;
  const ownerName = data.participants.find((person) => person.user_id === ownerId)?.display_name
    ?? (ownerId === data.currentUser.id ? data.currentUser.displayName : task.owner)
    ?? "未指定";
  return <Link href={`/tasks/${task.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold text-indigo-700">{roleLabel}</p><h4 className="mt-1 text-base font-extrabold text-slate-950">{task.title}</h4></div><span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{taskStatusDetailLabels[task.status]}</span></div><p className="mt-3 text-sm font-semibold text-slate-700"><span className="text-slate-500">下一步：</span>{task.next_action || "先補一個清晰下一步"}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span>負責：{ownerName}</span><span>截止：{formatDate(task.due_date)}</span><span>優先：{riskLabels[task.risk]}</span>{task.case_code ? <span>個案：{task.case_code}</span> : null}</div></Link>;
}

function PendingHandoff({ assignment, task }: { assignment: Assignment; task?: Task }) {
  return <div className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 p-4"><UserRoundCheck className="h-5 w-5 shrink-0 text-indigo-600" /><div><p className="font-extrabold text-slate-950">{task?.title ?? "一項新交接"}</p><p className="mt-1 text-sm text-slate-600">等待你確認是否接手；未接受前不會當作已開始。</p></div></div>;
}

function activeTask(task: Task) { return !["done", "cancelled"].includes(task.status) && !task.deleted_at && !task.archived_at; }
function uniqueTasks(tasks: Task[]) { return [...new Map(tasks.map((task) => [task.id, task])).values()]; }
function roleCategoryCounts(role: ReturnType<typeof resolveWorkspaceRole>, tasks: Task[]) {
  const active = tasks.filter(activeTask);
  if (role === "suki") return [`待安排 RN ${active.filter((task) => task.rn_required || task.task_type === "rn_coordination").length}`, `待準備物資 ${active.filter((task) => task.materials_required || task.task_type === "materials").length}`, `待回覆家屬 ${active.filter((task) => task.client_update_required).length}`];
  if (role === "amigo") return [`SOP ${active.filter((task) => task.task_type === "sop").length}`, `系統問題 ${active.filter((task) => task.task_type === "system_issue").length}`, `Compliance／Training ${active.filter((task) => ["compliance", "training"].includes(task.task_type ?? "")).length}`];
  if (role === "derek") return [`待臨床決定 ${active.filter((task) => task.needs_decision_from_id && !task.decision_resolved_at).length}`, `Assessment／Family Conference ${active.filter((task) => ["assessment", "family_conference"].includes(task.task_type ?? "")).length}`];
  return [];
}
function tomorrowAtNine() { const next = new Date(); next.setDate(next.getDate() + 1); next.setHours(9, 0, 0, 0); return next.toISOString(); }

