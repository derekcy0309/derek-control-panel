"use client";

import { type ReactNode, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Modal } from "@/components/Modal";
import { TaskForm } from "@/components/forms/TaskForm";
import { TaskCard } from "@/components/items/TaskCard";
import { Button } from "@/components/ui/Button";
import { riskOptions, sourceTypeOptions, taskStatusFilterOptions, unfinishedTaskStatuses } from "@/lib/labels";
import { taskCategoryFor, taskCategoryOptions, type TaskCategory } from "@/lib/task-categories";
import type { Task } from "@/lib/types";
import { useControlData } from "@/hooks/useControlData";

export default function TasksPage() {
  return (
    <AuthGate>
      <TasksContent />
    </AuthGate>
  );
}

function TasksContent() {
  const { data, loading, error, reload } = useControlData();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [familyExpanded, setFamilyExpanded] = useState(false);
  const [filters, setFilters] = useState({
    category: "",
    source_type: "",
    status: "",
    risk: "",
    due_date: "",
    show_completed: false
  });

  const filteredTasks = useMemo(() => {
    if (!data) return [];
    return data.tasks.filter((task) => {
      if (filters.category && taskCategoryFor(task) !== filters.category) return false;
      if (filters.source_type && task.source_type !== filters.source_type) return false;
      if (filters.status === "unfinished" && !unfinishedTaskStatuses.includes(task.status as (typeof unfinishedTaskStatuses)[number])) return false;
      if (filters.status && filters.status !== "unfinished" && task.status !== filters.status) return false;
      if (!filters.status && !filters.show_completed && task.status === "done") return false;
      if (filters.risk && task.risk !== filters.risk) return false;
      if (filters.due_date && task.due_date !== filters.due_date) return false;
      return true;
    });
  }, [data, filters]);

  if (loading || error || !data) return <LoadingState error={error} />;

  const personalTasks = filteredTasks.filter((task) => taskCategoryFor(task) === "personal");
  const familyTasks = filteredTasks.filter((task) => taskCategoryFor(task) === "family");
  const secTasks = filteredTasks.filter((task) => taskCategoryFor(task) === "sec");
  const wecareTasks = filteredTasks.filter((task) => taskCategoryFor(task) === "wecare");
  const showCategory = (category: TaskCategory) => !filters.category || filters.category === category;
  const isFamilyOpen = filters.category === "family" || familyExpanded;
  const renderTask = (task: Task) => (
    <TaskCard
      key={task.id}
      task={task}
      currentUserId={data.currentUser.id}
      participants={data.participants}
      assignments={data.assignments}
      handoffNotes={data.handoffNotes}
      allTasks={data.tasks}
      taskDependencies={data.taskDependencies}
      taskRecurrenceRules={data.taskRecurrenceRules}
      operatingItems={data.operatingItems}
      onChanged={reload}
      onEdit={setEditingTask}
    />
  );

  return (
    <div className="space-y-5">
      <section className="flex flex-col justify-between gap-4 rounded-2xl bg-white p-5 shadow-soft sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold text-indigo-600">任務管理</p>
          <h2 className="mt-1 text-2xl font-bold text-ink">任務</h2>
          <p className="mt-2 text-base text-slate-600">預設只顯示未完成和已取消任務；需要時可自行顯示已完成。</p>
        </div>
        <Button onClick={() => setIsAdding(true)}>
          <Plus className="h-5 w-5" />
          新增任務
        </Button>
      </section>

      <section className="panel p-4">
        <h3 className="mb-4 text-xl font-bold">篩選</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <FilterSelect label="分類" value={filters.category} onChange={(value) => setFilters({ ...filters, category: value })} options={taskCategoryOptions} />
          <FilterSelect label="類型" value={filters.source_type} onChange={(value) => setFilters({ ...filters, source_type: value })} options={sourceTypeOptions} />
          <FilterSelect label="狀態" value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} options={taskStatusFilterOptions} />
          <FilterSelect label="風險" value={filters.risk} onChange={(value) => setFilters({ ...filters, risk: value })} options={riskOptions} />
          <label>
            <span className="label">到期日</span>
            <input className="field mt-2" type="date" value={filters.due_date} onChange={(event) => setFilters({ ...filters, due_date: event.target.value })} />
          </label>
        </div>
        <label className="mt-4 flex items-center gap-3 text-base font-semibold text-slate-700">
          <input
            className="h-5 w-5 rounded border-slate-300 text-indigo-600"
            type="checkbox"
            checked={filters.show_completed}
            onChange={(event) => setFilters({ ...filters, show_completed: event.target.checked })}
          />
          顯示已完成任務
        </label>
      </section>

      <section className="grid gap-5">
        {showCategory("personal") ? <TaskGroup title="個人任務" description="目前需要處理的個人任務" tasks={personalTasks} renderTask={renderTask} /> : null}
        {showCategory("family") ? (
          <section className="panel overflow-hidden">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 p-5 text-left"
              onClick={() => setFamilyExpanded((current) => !current)}
              aria-expanded={isFamilyOpen}
            >
              <span>
                <span className="block text-xl font-bold text-ink">家庭任務</span>
                <span className="mt-1 block text-sm font-semibold text-slate-600">{familyTasks.length} 項；按這裡才顯示家庭工作</span>
              </span>
              {isFamilyOpen ? <ChevronDown className="h-6 w-6 text-indigo-700" /> : <ChevronRight className="h-6 w-6 text-indigo-700" />}
            </button>
            {isFamilyOpen ? <div className="grid gap-4 border-t border-slate-100 p-4 sm:p-5">{familyTasks.length ? familyTasks.map(renderTask) : <EmptyTaskGroup />}</div> : null}
          </section>
        ) : null}
        {showCategory("sec") ? <TaskGroup title="SEC 任務" description="目前需要處理的 SEC 任務" tasks={secTasks} renderTask={renderTask} /> : null}
        {showCategory("wecare") ? <TaskGroup title="Wecare 任務" description="目前需要處理的 Wecare 任務" tasks={wecareTasks} renderTask={renderTask} /> : null}
      </section>

      {isAdding ? (
        <Modal title="新增任務" onClose={() => setIsAdding(false)}>
          <TaskForm userId={data.currentUser.id} participants={data.participants} projects={data.operatingItems.filter((item) => item.item_type === "project")} onSaved={() => finish(reload, () => setIsAdding(false))} onCancel={() => setIsAdding(false)} />
        </Modal>
      ) : null}

      {editingTask ? (
        <Modal title="修改任務" onClose={() => setEditingTask(null)}>
          <TaskForm userId={data.currentUser.id} participants={data.participants} projects={data.operatingItems.filter((item) => item.item_type === "project")} initialTask={editingTask} initialNoticeUserIds={data.taskNoticeRecipients.filter((recipient) => recipient.task_id === editingTask.id).map((recipient) => recipient.recipient_id)} onSaved={() => finish(reload, () => setEditingTask(null))} onCancel={() => setEditingTask(null)} />
        </Modal>
      ) : null}
    </div>
  );
}

function TaskGroup({ title, description, tasks, renderTask }: {
  title: string;
  description: string;
  tasks: Task[];
  renderTask: (task: Task) => ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <div className="px-1">
        <h3 className="text-xl font-bold text-ink">{title}</h3>
        <p className="mt-1 text-sm font-semibold text-slate-600">{description} · {tasks.length} 項</p>
      </div>
      {tasks.length ? tasks.map(renderTask) : <EmptyTaskGroup />}
    </section>
  );
}

function EmptyTaskGroup() {
  return <div className="panel p-5 text-base text-slate-600">沒有符合條件的任務。</div>;
}

function FilterSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="label">{label}</span>
      <select className="field mt-2" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">全部</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function finish(reload: () => void, close: () => void) {
  reload();
  close();
}
