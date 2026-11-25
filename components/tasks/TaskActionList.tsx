"use client";

import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, Check, ListPlus, Printer, X } from "lucide-react";
import { Modal } from "@/components/Modal";
import { TaskForm, type TaskSaveResult } from "@/components/forms/TaskForm";
import { TaskDueCalendar } from "@/components/tasks/TaskDueCalendar";
import { TaskPrintSheet } from "@/components/tasks/TaskPrintSheet";
import { TaskQueueSection } from "@/components/tasks/TaskQueueSection";
import { Button } from "@/components/ui/Button";
import { useDaylineDate } from "@/hooks/useDaylineDate";
import { controlAction } from "@/lib/control-api";
import { isMyTask } from "@/lib/simple-mode";
import { taskTagColors } from "@/lib/task-tag-colors";
import { activeTaskTagFilter, allTaskTags, isTaskTagFilterSelected, matchesTaskTagFilter, selectAllTaskTags, toggleTaskTagFilter, type TaskTagFilter } from "@/lib/task-tag-filter";
import { taskMatchesTagText } from "@/lib/task-tag-ui";
import { taskQueueBuckets, taskQueuePriorityGroups } from "@/lib/task-queue";
import { createTaskPriorityProjection } from "@/lib/upcoming-task-priority";
import { isOverdueTask } from "@/lib/overdue-tasks";
import type { Task, TodayData } from "@/lib/types";

const primaryPreviewLimit = 5;

type TaskActionListProps = {
  data: TodayData;
  onChanged: () => Promise<unknown>;
  onTaskSaved?: (result?: TaskSaveResult) => void;
  restful?: boolean;
  showOverdue?: boolean;
  onExitOverdue?: () => void;
  sortByGrade: boolean;
  onToggleGradeSort: () => void;
};

export function TaskActionList(props: TaskActionListProps) {
  // The deep-linked overdue view starts unfiltered, independent of queue state.
  return <TaskActionListContent key={props.showOverdue ? "overdue" : "all"} {...props} />;
}

function TaskActionListContent({ data, onChanged, onTaskSaved, restful = false, showOverdue = false, onExitOverdue, sortByGrade, onToggleGradeSort }: TaskActionListProps) {
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedTags, setSelectedTags] = useState<TaskTagFilter>(allTaskTags);
  const [query, setQuery] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [todayBusyId, setTodayBusyId] = useState<string | null>(null);
  const [todayMessage, setTodayMessage] = useState("");
  const [todayError, setTodayError] = useState("");
  const today = useDaylineDate();
  const sourceTasks = useMemo(() => showOverdue
    ? data.taskQueueCatalog.filter(task => isOverdueTask(task, today)
      && isMyTask(task, data.currentUser.id, data.assignments))
    : data.taskQueueCatalog, [data.taskQueueCatalog, data.currentUser.id, data.assignments, showOverdue, today]);
  const priority = useMemo(() => createTaskPriorityProjection(data.taskTags ?? [], sourceTasks, today),
    [data.taskTags, sourceTasks, today]);
  const tagNames = useMemo(() => new Map(priority.catalog.map(tag => [tag.id, tag.name])), [priority.catalog]);
  const tagColors = useMemo(() => taskTagColors(priority.catalog), [priority.catalog]);
  const tagFilter = useMemo(() => activeTaskTagFilter(selectedTags, tagNames.keys()), [selectedTags, tagNames]);
  const allTagsChecked = tagFilter === selectAllTaskTags;
  const searchText = query.trim().toLocaleLowerCase();
  const tasksInCategory = useMemo(() => sourceTasks
    .filter((task) => {
      const ids = priority.ids(task);
      return matchesTaskTagFilter(ids, tagFilter)
        && (!searchText || taskMatchesTagText({ title: task.title, personal_tag_ids: ids }, searchText, tagNames));
    })
    .sort((a, b) => (showOverdue ? (a.due_date ?? "").localeCompare(b.due_date ?? "") : 0)
      || priority.rank(a) - priority.rank(b)),
  [sourceTasks, priority, tagFilter, searchText, tagNames, showOverdue]);
  const buckets = useMemo(() => taskQueueBuckets(tasksInCategory, today), [tasksInCategory, today]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of sourceTasks) {
      if (task.status === "done" || task.status === "cancelled") continue;
      for (const id of priority.ids(task)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [sourceTasks, priority]);

  const categoryLabel = tagFilter === "untagged" ? "未分類" : allTagsChecked || !tagFilter.size ? "全部" : [...tagFilter].map(id => tagNames.get(id)).join("／");
  const ready = tasksInCategory.filter((task) => !["done", "cancelled", "waiting", "blocked"].includes(task.status) && task.current_step_status !== "waiting");
  const gradeOrder = sortByGrade && !showOverdue;
  const groups = showOverdue ? [{ title: "已過限期", tasks: tasksInCategory }]
    : gradeOrder ? taskQueuePriorityGroups(tasksInCategory, priority.grade) : [
    { title: "未完成", tasks: ready },
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
    tagNames,
    tagColors,
    taskTagIds: priority.ids,
    onEdit: setEditingTask,
    todayTaskIds,
    bulkMode,
    selectedTaskIds: selectedTaskIdSet,
    todayBusyId,
    onSelect: selectTask,
    onAddToday: (task: Task) => void addOneToToday(task)
  };

  return (
    <section id="task-action-list" className="task-list-root dl-editorial-queue scroll-mt-24 space-y-5" aria-labelledby="task-action-list-heading">
      <div className="no-print space-y-5">
        <section className="dl-queue-heading">
          <div>
            <h2 id="task-action-list-heading">任務總表</h2>
            <p className="mt-1 text-sm text-slate-600">
              {showOverdue ? "只顯示由你跟進、已過限期但未完成嘅任務。" : gradeOrder ? "由最高分級開始排，只影響呢度，唔會改你手排嘅今日次序。" : restful ? "需要時先打開清單；任務沒有被移動。" : "可多選 Tags；符合其中一個就會顯示。"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {showOverdue && onExitOverdue ? <Button variant="secondary" onClick={onExitOverdue}>返回全部任務</Button> : null}
            {!showOverdue ? (
              <Button type="button" variant={gradeOrder ? "primary" : "secondary"} aria-pressed={gradeOrder} onClick={onToggleGradeSort}>
                <ArrowDownWideNarrow className="h-5 w-5" aria-hidden="true" />按分級排序
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => window.print()}><Printer className="h-5 w-5" />列印 A4 清單</Button>
            <Button variant="secondary" onClick={() => bulkMode ? cancelBulkMode() : setBulkMode(true)}>
              {bulkMode ? <X className="h-5 w-5" /> : <ListPlus className="h-5 w-5" />}
              {bulkMode ? "取消多選" : "多選加入今日"}
            </Button>
          </div>
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

        <section className="panel dl-queue-filters space-y-3 p-3 sm:p-4" aria-label="選擇任務 Tags">
          <input className="field" type="search" aria-label="搜尋 Task" placeholder="搵 Task 或 Tag…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`simple-tag-filter gap-1 ${allTagsChecked ? "is-active" : ""}`} aria-pressed={allTagsChecked} onClick={() => setSelectedTags(selectAllTaskTags)}>
              {allTagsChecked ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : null}全部
            </button>
            {priority.catalog.map(tag => {
              const selected = isTaskTagFilterSelected(tagFilter, tag.id);
              return <button type="button" key={tag.id} data-tag-id={tag.id} className="simple-tag-filter task-tag-color gap-1" style={tagColors.get(tag.id)} aria-pressed={selected} onClick={() => setSelectedTags(previous => toggleTaskTagFilter(activeTaskTagFilter(previous, tagNames.keys()), tag.id, tagNames.keys()))}>
                <Check aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${selected ? "" : "invisible"}`} />
                <span className="min-w-0 break-words font-extrabold">{tag.name}</span><span className="ml-1">{categoryCounts.get(tag.id) ?? 0}</span>
              </button>;
            })}
            <button type="button" className={`simple-tag-filter gap-1 ${tagFilter === "untagged" ? "is-active" : ""}`} aria-pressed={tagFilter === "untagged"} onClick={() => setSelectedTags(previous => previous === "untagged" ? allTaskTags : "untagged")}>
              {tagFilter === "untagged" ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : null}未分類
            </button>
          </div>
        </section>

        <section id={showOverdue ? "task-overdue" : undefined} tabIndex={showOverdue ? -1 : undefined} className="grid scroll-mt-24 gap-3" aria-label={showOverdue ? "已過限期任務" : gradeOrder ? "按分級顯示工作" : "按狀態顯示工作"}>
          {gradeOrder && !groups.length ? <p className="panel p-4 text-sm muted">而家冇符合篩選嘅未完成任務。</p> : null}
          {groups.map((group, index) => {
            const openByDefault = showOverdue || (gradeOrder && index === 0);
            return <TaskQueueSection key={`${group.title}:${openByDefault}`} title={group.title}
              description={showOverdue ? "由最早到期開始；等回覆或受阻任務亦會列出" : "按需要打開；先顯示首 5 件"}
              tasks={group.tasks} defaultOpen={openByDefault} previewLimit={primaryPreviewLimit} {...sectionProps} />;
          })}
          {!showOverdue ? <TaskQueueSection title="已做完／已取消" description="歷史紀錄，預設收起" tasks={buckets.completed} completed {...sectionProps} /> : null}
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
              knownTags={data.taskTags}
              statusSuggestions={statusSuggestions}
              onSaved={(result) => finish(result, onTaskSaved, onChanged, () => setEditingTask(null))}
              onCancel={() => setEditingTask(null)}
            />
          </Modal>
        ) : null}
      </div>

      <TaskPrintSheet categoryLabel={categoryLabel} buckets={buckets} groups={groups} printedOn={today} />
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
