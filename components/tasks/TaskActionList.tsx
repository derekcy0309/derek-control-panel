"use client";

import { useMemo, useState } from "react";
import { Check, ListPlus, Printer, X } from "lucide-react";
import { Modal } from "@/components/Modal";
import { SectionArtwork } from "@/components/SectionArtwork";
import { TaskForm, type TaskSaveResult } from "@/components/forms/TaskForm";
import { TaskDueCalendar } from "@/components/tasks/TaskDueCalendar";
import { TaskPrintSheet } from "@/components/tasks/TaskPrintSheet";
import { TaskQueueSection } from "@/components/tasks/TaskQueueSection";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { hkDateIso } from "@/lib/planning";
import { simplePriority, sortByPriority } from "@/lib/simple-mode";
import { taskQueueBuckets } from "@/lib/task-queue";
import type { Task, TodayData } from "@/lib/types";

const primaryPreviewLimit = 5;

export function TaskActionList({
  data,
  onChanged,
  onTaskSaved,
  restful = false
}: {
  data: TodayData;
  onChanged: () => Promise<unknown>;
  onTaskSaved?: (result?: TaskSaveResult) => void;
  restful?: boolean;
}) {
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [query, setQuery] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [todayBusyId, setTodayBusyId] = useState<string | null>(null);
  const [todayMessage, setTodayMessage] = useState("");
  const [todayError, setTodayError] = useState("");
  const today = hkDateIso();
  const tagFilter = selectedCategory === "untagged" || data.taskTags?.some((tag) => tag.id === selectedCategory) ? selectedCategory : "";
  const tasksInCategory = useMemo(
    () => sortByPriority(data.taskQueueCatalog.filter((task) => (!tagFilter || (tagFilter === "untagged" ? !task.personal_tag_ids?.length : task.personal_tag_ids?.includes(tagFilter)))
      && (!query.trim() || task.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))),
    [data.taskQueueCatalog, tagFilter, query]
  );
  const buckets = useMemo(() => taskQueueBuckets(tasksInCategory, today), [tasksInCategory, today]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of data.taskQueueCatalog) {
      if (task.status === "done" || task.status === "cancelled") continue;
      for (const id of task.personal_tag_ids ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [data.taskQueueCatalog]);

  const categoryLabel = tagFilter === "untagged" ? "未分類" : data.taskTags?.find((tag) => tag.id === tagFilter)?.name ?? "全部";
  const ready = tasksInCategory.filter((task) => !["done", "cancelled", "waiting", "blocked"].includes(task.status) && task.current_step_status !== "waiting");
  const simpleGroups = [
    { title: "P1 高 High", tasks: ready.filter((task) => simplePriority(task.requested_priority) === 1) },
    { title: "P2 一般 Normal", tasks: ready.filter((task) => simplePriority(task.requested_priority) === 3) },
    { title: "P3 低 Low", tasks: ready.filter((task) => simplePriority(task.requested_priority) === 5) },
    { title: "等回覆 Waiting", tasks: buckets.waiting },
    { title: "等解除阻塞", tasks: buckets.blocked }
  ];
  const statusSuggestions = [...new Set(data.taskQueueCatalog.map((task) => task.custom_status_label?.trim()).filter((value): value is string => Boolean(value)))].sort();
  const datedTasks = tasksInCategory.filter((task) => task.due_date && task.status !== "done" && task.status !== "cancelled");
  const todayTaskIds = useMemo(() => new Set(
    data.planning
      .filter((item) => item.resource_type === "task" && item.planned_date === today)
      .map((item) => item.resource_id)
  ), [data.planning, today]);
  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);

  async function addOneToToday(task: Task) {
    if (todayBusyId) return;
    setTodayBusyId(task.id);
    setTodayMessage("");
    setTodayError("");
    try {
      await controlAction("set_today_task", { taskId: task.id, included: true });
      await onChanged();
      setTodayMessage(`已將「${task.title}」加入今日；任務日期及狀態沒有改動。`);
    } catch (caught) {
      setTodayError(caught instanceof Error ? caught.message : "未能加入今日。");
    } finally {
      setTodayBusyId(null);
    }
  }

  async function addSelectedToToday() {
    if (!selectedTaskIds.length || todayBusyId) return;
    setTodayBusyId("bulk");
    setTodayMessage("");
    setTodayError("");
    const results = await Promise.allSettled(selectedTaskIds.map((taskId) =>
      controlAction("set_today_task", { taskId, included: true })
    ));
    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - succeeded;
    await onChanged();
    if (succeeded) setTodayMessage(`已將 ${succeeded} 項任務加入今日。`);
    if (failed) setTodayError(`${failed} 項未能加入，其他成功項目已保留。`);
    setSelectedTaskIds([]);
    setBulkMode(false);
    setTodayBusyId(null);
  }

  function selectTask(task: Task, selected: boolean) {
    setSelectedTaskIds((current) => selected
      ? [...new Set([...current, task.id])]
      : current.filter((id) => id !== task.id));
  }

  function cancelBulkMode() {
    setBulkMode(false);
    setSelectedTaskIds([]);
  }

  const sectionProps = {
    onChanged,
    onEdit: setEditingTask,
    todayTaskIds,
    bulkMode,
    selectedTaskIds: selectedTaskIdSet,
    todayBusyId,
    onSelect: selectTask,
    onAddToday: (task: Task) => void addOneToToday(task)
  };

  return (
    <section id="task-action-list" className="task-list-root scroll-mt-24 space-y-5" aria-labelledby="task-action-list-heading">
      <div className="no-print space-y-5">
        <section data-section={selectedCategory === "family" ? "family" : selectedCategory === "personal" ? "personal" : "work"} className="task-list-hero section-hero flex flex-col justify-between gap-4 rounded-2xl p-5 shadow-soft sm:flex-row sm:items-center">
          <div className="relative z-10">
            <p className="text-sm font-extrabold text-indigo-700">Action Center</p>
            <h2 id="task-action-list-heading" className="mt-1 text-2xl font-bold text-ink">任務總表</h2>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              {restful ? "需要時先打開清單；任務沒有被移動。" : "按 Priority 分組，揀 Tag 或搜尋；需要時先打開，唔使一次睇晒。"}
            </p>
          </div>
          <div className="relative z-10 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => window.print()}><Printer className="h-5 w-5" />列印 A4 清單</Button>
            <Button variant="secondary" onClick={() => bulkMode ? cancelBulkMode() : setBulkMode(true)}>
              {bulkMode ? <X className="h-5 w-5" /> : <ListPlus className="h-5 w-5" />}
              {bulkMode ? "取消多選" : "多選加入今日"}
            </Button>
          </div>
          <SectionArtwork section={selectedCategory === "family" ? "family" : selectedCategory === "personal" ? "personal" : "work"} compact />
        </section>

        {bulkMode ? (
          <section className="sticky top-20 z-20 flex flex-col justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center" aria-label="批量加入今日">
            <div>
              <p className="font-extrabold text-indigo-950">揀選一項或多項可執行任務</p>
              <p className="mt-1 text-sm font-semibold text-indigo-700">已選 {selectedTaskIds.length} 項；Waiting、Blocked 及已完成任務不會顯示剔選格。</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={cancelBulkMode}>取消</Button>
              <Button disabled={!selectedTaskIds.length || todayBusyId === "bulk"} onClick={() => void addSelectedToToday()}>
                <Check className="h-4 w-4" />{todayBusyId === "bulk" ? "加入中…" : `加入今日（${selectedTaskIds.length}）`}
              </Button>
            </div>
          </section>
        ) : null}

        {todayMessage ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">{todayMessage}</p> : null}
        {todayError ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{todayError}</p> : null}

        <section className="panel space-y-3 p-3 sm:p-4" aria-label="選擇任務 Tags">
          <input className="field" type="search" aria-label="搜尋 Task" placeholder="搵 Task…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            {[{ value: "", label: "全部" }, ...(data.taskTags ?? []).map((tag) => ({ value: tag.id, label: tag.name })), { value: "untagged", label: "未分類" }].map((option) => {
              const selected = tagFilter === option.value;
              return (
                <button
                  type="button"
                  key={option.value}
                  className={`simple-tag-filter ${selected ? "is-active" : ""}`}
                  onClick={() => setSelectedCategory(option.value)}
                  aria-pressed={selected}
                >
                  <span className="block font-extrabold">{option.label}</span>
                  {option.value && option.value !== "untagged" ? <span className="ml-1 opacity-60">{categoryCounts.get(option.value) ?? 0}</span> : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-3" aria-label="按 Priority 排列的工作">
          {simpleGroups.map((group) => <TaskQueueSection key={`${tagFilter}-${group.title}`} title={group.title} description="按需要打開；先顯示首 5 件" tasks={group.tasks} previewLimit={primaryPreviewLimit} {...sectionProps} />)}
          <TaskQueueSection key={`${tagFilter}-completed`} title="已做完／已取消" description="歷史紀錄，預設收起" tasks={buckets.completed} completed {...sectionProps} />
        </section>

        <details className="panel p-4">
          <summary className="min-h-11 cursor-pointer py-2 font-bold">到期日曆</summary>
        <section className="grid gap-3" aria-labelledby="task-calendar-heading">
          <div className="px-1">
            <p className="eyebrow">Calendar view</p>
            <h3 id="task-calendar-heading" className="section-title mt-1">到期日曆</h3>
            <p className="muted mt-1 text-sm">日曆放在清單最底，只用來查看有日期的任務。</p>
          </div>
          <TaskDueCalendar tasks={datedTasks} today={today} />
        </section>
        </details>

        {editingTask ? (
          <Modal title="修改任務" onClose={() => setEditingTask(null)}>
            <TaskForm
              userId={data.currentUser.id}
              participants={data.participants}
              initialTask={editingTask}
              initialNoticeUserIds={data.taskNoticeRecipients.filter((recipient) => recipient.task_id === editingTask.id).map((recipient) => recipient.recipient_id)}
              initialFollowerUserIds={data.taskFollowers.filter((follower) => follower.task_id === editingTask.id).map((follower) => follower.follower_id)}
              statusSuggestions={statusSuggestions}
              onSaved={(result) => finish(result, onTaskSaved, onChanged, () => setEditingTask(null))}
              onCancel={() => setEditingTask(null)}
            />
          </Modal>
        ) : null}
      </div>

      <TaskPrintSheet categoryLabel={categoryLabel} buckets={buckets} groups={simpleGroups} printedOn={today} />
    </section>
  );
}

function finish(
  result: TaskSaveResult | undefined,
  onTaskSaved: ((result?: TaskSaveResult) => void) | undefined,
  reload: () => Promise<unknown>,
  close: () => void
) {
  close();
  if (onTaskSaved) onTaskSaved(result);
  else void reload();
}
