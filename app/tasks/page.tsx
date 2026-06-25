"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Modal } from "@/components/Modal";
import { TaskForm } from "@/components/forms/TaskForm";
import { TaskCard } from "@/components/items/TaskCard";
import { Button } from "@/components/ui/Button";
import { riskOptions, scopeOptions, sourceTypeOptions, taskStatusOptions } from "@/lib/labels";
import type { Task } from "@/lib/types";
import { useAppData } from "@/hooks/useAppData";

export default function TasksPage() {
  return (
    <AuthGate>
      <TasksContent />
    </AuthGate>
  );
}

function TasksContent() {
  const { data, userId, loading, error, reload } = useAppData();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [filters, setFilters] = useState({
    scope: "",
    source_type: "",
    status: "",
    risk: "",
    due_date: ""
  });

  const filteredTasks = useMemo(() => {
    return data.tasks.filter((task) => {
      if (filters.scope && task.scope !== filters.scope) return false;
      if (filters.source_type && task.source_type !== filters.source_type) return false;
      if (filters.status && task.status !== filters.status) return false;
      if (filters.risk && task.risk !== filters.risk) return false;
      if (filters.due_date && task.due_date !== filters.due_date) return false;
      return true;
    });
  }, [data.tasks, filters]);

  if (loading || error || !userId) return <LoadingState error={error} />;

  return (
    <div className="space-y-5">
      <section className="flex flex-col justify-between gap-4 rounded-2xl bg-white p-5 shadow-soft sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold text-indigo-600">任務管理</p>
          <h2 className="mt-1 text-2xl font-bold text-ink">任務</h2>
          <p className="mt-2 text-base text-slate-600">每個任務都要有下一步，避免大腦被模糊事項卡住。</p>
        </div>
        <Button onClick={() => setIsAdding(true)}>
          <Plus className="h-5 w-5" />
          新增任務
        </Button>
      </section>

      <section className="panel p-4">
        <h3 className="mb-4 text-xl font-bold">篩選</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <FilterSelect label="家庭 / 公司" value={filters.scope} onChange={(value) => setFilters({ ...filters, scope: value })} options={scopeOptions} />
          <FilterSelect label="類型" value={filters.source_type} onChange={(value) => setFilters({ ...filters, source_type: value })} options={sourceTypeOptions} />
          <FilterSelect label="狀態" value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} options={taskStatusOptions} />
          <FilterSelect label="風險" value={filters.risk} onChange={(value) => setFilters({ ...filters, risk: value })} options={riskOptions} />
          <label>
            <span className="label">到期日</span>
            <input className="field mt-2" type="date" value={filters.due_date} onChange={(event) => setFilters({ ...filters, due_date: event.target.value })} />
          </label>
        </div>
      </section>

      <section className="grid gap-4">
        {filteredTasks.length ? (
          filteredTasks.map((task) => <TaskCard key={task.id} task={task} onChanged={reload} onEdit={setEditingTask} />)
        ) : (
          <div className="panel p-5 text-base text-slate-600">沒有符合條件的任務。</div>
        )}
      </section>

      {isAdding ? (
        <Modal title="新增任務" onClose={() => setIsAdding(false)}>
          <TaskForm userId={userId} onSaved={() => finish(reload, () => setIsAdding(false))} onCancel={() => setIsAdding(false)} />
        </Modal>
      ) : null}

      {editingTask ? (
        <Modal title="修改任務" onClose={() => setEditingTask(null)}>
          <TaskForm userId={userId} initialTask={editingTask} onSaved={() => finish(reload, () => setEditingTask(null))} onCancel={() => setEditingTask(null)} />
        </Modal>
      ) : null}
    </div>
  );
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
