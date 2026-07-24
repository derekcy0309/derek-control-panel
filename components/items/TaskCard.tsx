"use client";

import { CalendarClock, FilePenLine } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TaskHandoffControls } from "@/components/items/TaskHandoffControls";
import { RiskBadge, ScopeBadge, StatusBadge } from "@/components/ui/Badge";
import { formatDate, addDaysIso } from "@/lib/date";
import { sourceTypeLabels } from "@/lib/labels";
import { controlAction } from "@/lib/control-api";
import type { Assignment, HandoffNote, Task } from "@/lib/types";

export function TaskCard({
  task,
  onChanged,
  onEdit,
  currentUserId,
  participants,
  assignments,
  handoffNotes,
  prominent = false
}: {
  task: Task;
  onChanged: () => void;
  onEdit?: (task: Task) => void;
  currentUserId: string;
  participants: Array<{ user_id: string; display_name: string }>;
  assignments: Assignment[];
  handoffNotes: HandoffNote[];
  prominent?: boolean;
}) {
  const activeHandoff = assignments.some((item) =>
    item.resource_type === "task"
    && item.resource_id === task.id
    && ["pending_acceptance","accepted","in_progress","waiting","blocked"].includes(item.status)
  );
  async function updateTask(values: Partial<Task>) {
    await controlAction("update_task", { id: task.id, changes: values });
    onChanged();
  }

  async function completeTask() {
    await updateTask({ status: "done", completed_at: new Date().toISOString() });
  }

  async function delay(days?: number) {
    const nextDate = days ? addDaysIso(days) : window.prompt("請輸入延後日期，例如 2026-07-01");
    if (!nextDate) return;
    await updateTask({ follow_up_date: nextDate });
  }

  return (
    <article className={prominent ? "rounded-2xl border-2 border-indigo-200 bg-white p-5 shadow-soft" : "panel-soft p-4"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-2">
            <ScopeBadge scope={task.scope} />
            <StatusBadge status={task.status} />
            <RiskBadge risk={task.risk} />
          </div>
          <h3 className="mt-3 text-xl font-bold text-ink">{task.title}</h3>
          <p className="mt-2 text-base font-semibold text-slate-600">{sourceTypeLabels[task.source_type]}</p>
        </div>
        {onEdit ? (
          <Button variant="secondary" onClick={() => onEdit(task)} title="修改">
            <FilePenLine className="h-5 w-5" />
            修改
          </Button>
        ) : null}
      </div>
      <TaskHandoffControls
        task={task}
        currentUserId={currentUserId}
        participants={participants}
        assignments={assignments}
        notes={handoffNotes}
        onChanged={onChanged}
      />
      <div className="mt-4 grid gap-3 text-base text-slate-700 sm:grid-cols-2">
        <p className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-indigo-600" />
          到期：{formatDate(task.due_date)}
        </p>
        <p>跟進：{formatDate(task.follow_up_date)}</p>
        {task.completed_at ? <p>完成日期及時間：{formatDateTime(task.completed_at)}</p> : null}
        <p className="sm:col-span-2">
          <span className="font-semibold">下一步：</span>
          {task.next_action || "未設定"}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {!activeHandoff ? <Button variant="success" onClick={completeTask}>完全完成任務</Button> : null}
        <Button variant="secondary" onClick={() => delay(1)}>
          延後 1 日
        </Button>
        <Button variant="secondary" onClick={() => delay(3)}>
          延後 3 日
        </Button>
        <Button variant="secondary" onClick={() => delay(7)}>
          延後 7 日
        </Button>
        <Button variant="secondary" onClick={() => delay()}>
          自訂日期
        </Button>
        <Button variant="danger" onClick={() => updateTask({ status: "blocked" })}>
          有問題
        </Button>
        <Button variant="ghost" onClick={() => updateTask({ status: "cancelled" })}>
          取消
        </Button>
        <Button variant="danger" onClick={() => window.confirm("任務會移到保留區，30 日後才永久刪除。確定？") && updateTask({ deleted_at: new Date().toISOString() })}>
          刪除
        </Button>
      </div>
    </article>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
