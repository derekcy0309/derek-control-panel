"use client";

import { useMemo, useState } from "react";
import { Plus, Printer } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Modal } from "@/components/Modal";
import { TaskForm } from "@/components/forms/TaskForm";
import { TaskDueCalendar } from "@/components/tasks/TaskDueCalendar";
import { TaskPrintSheet } from "@/components/tasks/TaskPrintSheet";
import { TaskQueueSection } from "@/components/tasks/TaskQueueSection";
import { Button } from "@/components/ui/Button";
import { useControlData } from "@/hooks/useControlData";
import { hkDateIso } from "@/lib/planning";
import { taskCategoryFields, taskCategoryFor, taskCategoryOptions, type TaskCategory } from "@/lib/task-categories";
import { taskQueueBuckets } from "@/lib/task-queue";
import type { Task } from "@/lib/types";

const primaryPreviewLimit = 5;

export default function TasksPage() {
  return <AuthGate><TasksContent /></AuthGate>;
}

function TasksContent() {
  const { data, loading, error, reload } = useControlData();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<TaskCategory>("personal");
  const today = hkDateIso();
  const tasksInCategory = useMemo(
    () => data?.tasks.filter((task) => taskCategoryFor(task) === selectedCategory) ?? [],
    [data?.tasks, selectedCategory]
  );
  const buckets = useMemo(() => taskQueueBuckets(tasksInCategory, today), [tasksInCategory, today]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<TaskCategory, number>(taskCategoryOptions.map((option) => [option.value, 0]));
    for (const task of data?.tasks ?? []) {
      if (task.status === "done" || task.status === "cancelled") continue;
      const category = taskCategoryFor(task);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return counts;
  }, [data?.tasks]);

  if (loading || error || !data) return <LoadingState error={error} />;

  const categoryLabel = taskCategoryOptions.find((option) => option.value === selectedCategory)?.label ?? selectedCategory;
  const categoryFields = taskCategoryFields(selectedCategory);
  const datedTasks = tasksInCategory.filter((task) => task.due_date && task.status !== "done" && task.status !== "cancelled");
  const sectionProps = { onChanged: reload, onEdit: setEditingTask };

  return (
    <div className="task-list-root space-y-5">
      <div className="no-print space-y-5">
        <section className="flex flex-col justify-between gap-4 rounded-2xl bg-white p-5 shadow-soft sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold text-indigo-600">任務管理</p>
            <h1 className="mt-1 text-2xl font-bold text-ink">任務行動清單</h1>
            <p className="mt-2 text-sm font-semibold text-slate-600">先處理逾期、7 日內到期和 Urgent；其餘工作預設收起，減少畫面壓力。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => window.print()}><Printer className="h-5 w-5" />列印 A4 清單</Button>
            <Button onClick={() => setIsAdding(true)}><Plus className="h-5 w-5" />新增任務</Button>
          </div>
        </section>

        <section className="panel p-3 sm:p-4" aria-label="選擇任務分類">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {taskCategoryOptions.map((option) => {
              const selected = selectedCategory === option.value;
              return (
                <button
                  type="button"
                  key={option.value}
                  className={`min-h-14 rounded-xl px-3 text-left transition ${selected ? "bg-indigo-600 text-white shadow-md" : "bg-slate-50 text-slate-700 hover:bg-indigo-50"}`}
                  onClick={() => setSelectedCategory(option.value)}
                  aria-pressed={selected}
                >
                  <span className="block font-extrabold">{option.label}</span>
                  <span className={`mt-0.5 block text-xs font-bold ${selected ? "text-indigo-100" : "text-slate-500"}`}>{categoryCounts.get(option.value) ?? 0} 項未完成</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-3" aria-labelledby="priority-task-heading">
          <div className="px-1">
            <p className="eyebrow">Act first</p>
            <h2 id="priority-task-heading" className="section-title mt-1">優先處理</h2>
            <p className="muted mt-1 text-sm">每組先顯示首 {primaryPreviewLimit} 項；需要時才展開全部。</p>
          </div>
          <TaskQueueSection key={`${selectedCategory}-overdue`} title="已逾期" description="需要重新確認或立即處理" tasks={buckets.overdue} tone="overdue" defaultOpen previewLimit={primaryPreviewLimit} {...sectionProps} />
          <TaskQueueSection key={`${selectedCategory}-7-days`} title="今日至未來 7 日" description="黃色提示：近期到期" tasks={buckets.dueWithin7Days} tone="soon" defaultOpen previewLimit={primaryPreviewLimit} {...sectionProps} />
          <TaskQueueSection key={`${selectedCategory}-urgent`} title="Urgent（無日期）" description="沒有正式日期，但需要盡快處理" tasks={buckets.urgent} tone="urgent" defaultOpen previewLimit={primaryPreviewLimit} {...sectionProps} />
        </section>

        <TaskDueCalendar tasks={datedTasks} today={today} />

        <section className="grid gap-3" aria-labelledby="other-task-heading">
          <div className="px-1">
            <p className="eyebrow">Open when needed</p>
            <h2 id="other-task-heading" className="section-title mt-1">其他任務</h2>
            <p className="muted mt-1 text-sm">以下分組預設收起，標題仍會顯示項目數量。</p>
          </div>
          <TaskQueueSection key={`${selectedCategory}-14-days`} title="第 8 至 14 日" description="藍色提示：需要預先留意" tasks={buckets.dueWithin14Days} tone="upcoming" {...sectionProps} />
          <TaskQueueSection key={`${selectedCategory}-later`} title="第 15 日以後" description="較後期的有日期任務" tasks={buckets.dueLater} {...sectionProps} />
          <TaskQueueSection key={`${selectedCategory}-semi`} title="Semi-urgent（無日期）" description="近期應推進，但未需要即時處理" tasks={buckets.semiUrgent} {...sectionProps} />
          <TaskQueueSection key={`${selectedCategory}-non-urgent`} title="Non-urgent（無日期）" description="未有即時時間壓力" tasks={buckets.nonUrgent} {...sectionProps} />
          <TaskQueueSection key={`${selectedCategory}-waiting`} title="Waiting" description="控制權暫時在其他人手上" tasks={buckets.waiting} {...sectionProps} />
          <TaskQueueSection key={`${selectedCategory}-blocked`} title="Blocked" description="需要先解除阻塞原因" tasks={buckets.blocked} {...sectionProps} />
          <TaskQueueSection key={`${selectedCategory}-completed`} title="已完成／已取消" description="歷史項目，預設收起" tasks={buckets.completed} completed {...sectionProps} />
        </section>

        {isAdding ? (
          <Modal title={`新增${categoryLabel}任務`} onClose={() => setIsAdding(false)}>
            <TaskForm
              userId={data.currentUser.id}
              participants={data.participants}
              projects={data.operatingItems.filter((item) => item.item_type === "project")}
              preset={{ task_category: selectedCategory, area: categoryFields.area, scope: categoryFields.scope }}
              onSaved={() => finish(reload, () => setIsAdding(false))}
              onCancel={() => setIsAdding(false)}
            />
          </Modal>
        ) : null}

        {editingTask ? (
          <Modal title="修改任務" onClose={() => setEditingTask(null)}>
            <TaskForm
              userId={data.currentUser.id}
              participants={data.participants}
              projects={data.operatingItems.filter((item) => item.item_type === "project")}
              initialTask={editingTask}
              initialNoticeUserIds={data.taskNoticeRecipients.filter((recipient) => recipient.task_id === editingTask.id).map((recipient) => recipient.recipient_id)}
              initialFollowerUserIds={data.taskFollowers.filter((follower) => follower.task_id === editingTask.id).map((follower) => follower.follower_id)}
              onSaved={() => finish(reload, () => setEditingTask(null))}
              onCancel={() => setEditingTask(null)}
            />
          </Modal>
        ) : null}
      </div>

      <TaskPrintSheet categoryLabel={categoryLabel} buckets={buckets} printedOn={today} />
    </div>
  );
}

function finish(reload: () => void, close: () => void) {
  reload();
  close();
}
