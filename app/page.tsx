"use client";

import { useMemo, useState } from "react";
import { Plus, ReceiptText, WalletCards, CalendarPlus } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Modal } from "@/components/Modal";
import { TaskForm } from "@/components/forms/TaskForm";
import { TransactionForm } from "@/components/forms/TransactionForm";
import { MeetingForm } from "@/components/forms/MeetingForm";
import { TaskCard } from "@/components/items/TaskCard";
import { TransactionCard } from "@/components/items/TransactionCard";
import { Button } from "@/components/ui/Button";
import { ScopeBadge, StatusBadge } from "@/components/ui/Badge";
import { getCashflowSummary } from "@/lib/cashflow";
import { currentMonth, formatCurrency, formatDate } from "@/lib/date";
import { getFocusItems, getOverdueTasks, getProblemItems, getTodayFollowUps, getUpcomingTransactions } from "@/lib/dashboard";
import { transactionTypeLabels } from "@/lib/labels";
import type { FocusItem } from "@/lib/dashboard";
import { useAppData } from "@/hooks/useAppData";

type QuickModal = "task" | "income" | "expense" | "meeting" | null;

export default function HomePage() {
  return (
    <AuthGate>
      <Dashboard />
    </AuthGate>
  );
}

function Dashboard() {
  const { data, userId, loading, error, reload } = useAppData();
  const [todayMode, setTodayMode] = useState(true);
  const [modal, setModal] = useState<QuickModal>(null);

  const focusItems = useMemo(() => getFocusItems(data.tasks, data.transactions), [data.tasks, data.transactions]);
  const focusItem = focusItems[0];
  const problems = useMemo(() => getProblemItems(data.tasks, data.transactions), [data.tasks, data.transactions]);
  const overdue = useMemo(() => getOverdueTasks(data.tasks), [data.tasks]);
  const followUps = useMemo(() => getTodayFollowUps(data.tasks), [data.tasks]);
  const upcoming = useMemo(() => getUpcomingTransactions(data.transactions), [data.transactions]);
  const highRisk = data.tasks.filter((task) => task.risk === "high" && task.status !== "done" && task.status !== "cancelled").slice(0, 3);
  const homeSummary = getCashflowSummary(data.transactions, data.balances, "home", currentMonth());
  const companySummary = getCashflowSummary(data.transactions, data.balances, "company", currentMonth());

  if (loading || error || !userId) return <LoadingState error={error} />;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-indigo-600">今日外置執行功能</p>
            <h2 className="mt-1 text-2xl font-bold text-ink sm:text-3xl">今日只做一件</h2>
            <p className="mt-2 text-base text-slate-600">先處理最重要的一件，其餘只是背景噪音。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant={todayMode ? "primary" : "secondary"} onClick={() => setTodayMode((value) => !value)}>
              今日模式
            </Button>
            <QuickButton icon={<Plus className="h-5 w-5" />} label="新增任務" onClick={() => setModal("task")} />
            <QuickButton icon={<WalletCards className="h-5 w-5" />} label="新增收入" onClick={() => setModal("income")} />
            <QuickButton icon={<ReceiptText className="h-5 w-5" />} label="新增支出" onClick={() => setModal("expense")} />
            <QuickButton icon={<CalendarPlus className="h-5 w-5" />} label="新增會議" onClick={() => setModal("meeting")} />
          </div>
        </div>
        <div className="mt-5">
          {focusItem ? (
            <FocusCard item={focusItem} onChanged={reload} />
          ) : (
            <div className="rounded-xl bg-emerald-50 p-5 text-base font-semibold text-emerald-800">今日沒有燃眉之急，可以選一件低阻力任務開始。</div>
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <SummaryCard title="家庭區" tone="home" value={formatCurrency(homeSummary.projectedBalance)} caption="預計期末結餘" />
        <SummaryCard title="公司區" tone="company" value={formatCurrency(companySummary.projectedBalance)} caption="預計期末結餘" />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Panel title="最多 3 個高風險項目">
          <div className="space-y-3">
            {highRisk.length ? highRisk.map((task) => <TaskMini key={task.id} task={task} />) : <Empty text="暫時沒有高風險項目。" />}
          </div>
        </Panel>
        <Panel title="今日要跟進">
          <div className="space-y-3">
            {followUps.length ? followUps.slice(0, 4).map((task) => <TaskMini key={task.id} task={task} />) : <Empty text="今日沒有指定跟進。" />}
          </div>
        </Panel>
        <Panel title="未來 7 日收入 / 支出">
          <div className="space-y-3">
            {upcoming.length ? (
              upcoming.slice(0, 5).map((item) => (
                <div key={item.id} className="rounded-lg bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-slate-900">{item.item}</p>
                    <p className="font-bold">{formatCurrency(Number(item.amount))}</p>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {transactionTypeLabels[item.type]} · {formatDate(item.expected_date)}
                  </p>
                </div>
              ))
            ) : (
              <Empty text="未來 7 日沒有待處理收入支出。" />
            )}
          </div>
        </Panel>
      </section>

      {!todayMode ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <Panel title="有問題項目">
            <div className="space-y-3">
              {problems.tasks.map((task) => <TaskMini key={task.id} task={task} />)}
              {problems.transactions.map((item) => <TransactionMini key={item.id} item={item} />)}
              {!problems.tasks.length && !problems.transactions.length ? <Empty text="暫時沒有有問題項目。" /> : null}
            </div>
          </Panel>
          <Panel title="已逾期項目">
            <div className="space-y-3">
              {overdue.length ? overdue.map((task) => <TaskMini key={task.id} task={task} />) : <Empty text="暫時沒有逾期項目。" />}
            </div>
          </Panel>
        </section>
      ) : null}

      {modal ? (
        <Modal title={modalTitle[modal]} onClose={() => setModal(null)}>
          {modal === "task" ? <TaskForm userId={userId} compact onSaved={() => finishQuickAdd(reload, setModal)} onCancel={() => setModal(null)} /> : null}
          {modal === "income" ? (
            <TransactionForm userId={userId} forcedType="income" compact onSaved={() => finishQuickAdd(reload, setModal)} onCancel={() => setModal(null)} />
          ) : null}
          {modal === "expense" ? (
            <TransactionForm userId={userId} forcedType="expense" compact onSaved={() => finishQuickAdd(reload, setModal)} onCancel={() => setModal(null)} />
          ) : null}
          {modal === "meeting" ? <MeetingForm userId={userId} compact onSaved={() => finishQuickAdd(reload, setModal)} onCancel={() => setModal(null)} /> : null}
        </Modal>
      ) : null}
    </div>
  );
}

const modalTitle: Record<Exclude<QuickModal, null>, string> = {
  task: "快速新增任務",
  income: "快速新增收入",
  expense: "快速新增支出",
  meeting: "快速新增會議"
};

function finishQuickAdd(reload: () => void, setModal: (value: QuickModal) => void) {
  reload();
  setModal(null);
}

function QuickButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Button variant="secondary" onClick={onClick}>
      {icon}
      {label}
    </Button>
  );
}

function FocusCard({ item, onChanged }: { item: FocusItem; onChanged: () => void }) {
  if (item.kind === "task") {
    return <TaskCard task={item.task} onChanged={onChanged} prominent />;
  }
  return <TransactionCard transaction={item.transaction} onChanged={onChanged} highlight />;
}

function SummaryCard({ title, value, caption, tone }: { title: string; value: string; caption: string; tone: "home" | "company" }) {
  return (
    <div className={tone === "home" ? "rounded-xl bg-home-50 p-5 shadow-soft" : "rounded-xl bg-work-50 p-5 shadow-soft"}>
      <p className="text-base font-semibold text-slate-700">{title}</p>
      <p className="mt-2 text-3xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-base text-slate-600">{caption}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <h3 className="mb-4 text-xl font-bold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function TaskMini({ task }: { task: import("@/lib/types").Task }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="flex flex-wrap gap-2">
        <ScopeBadge scope={task.scope} />
        <StatusBadge status={task.status} />
      </div>
      <p className="mt-2 font-semibold text-slate-900">{task.title}</p>
      <p className="mt-1 text-sm text-slate-600">下一步：{task.next_action}</p>
    </div>
  );
}

function TransactionMini({ item }: { item: import("@/lib/types").Transaction }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="flex flex-wrap gap-2">
        <ScopeBadge scope={item.scope} />
        <StatusBadge status={item.status} />
      </div>
      <p className="mt-2 font-semibold text-slate-900">{item.item}</p>
      <p className="mt-1 text-sm text-slate-600">
        {transactionTypeLabels[item.type]} · {formatCurrency(Number(item.amount))}
      </p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg bg-slate-50 p-3 text-base text-slate-600">{text}</p>;
}
