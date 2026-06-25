"use client";

import { CalendarClock, FilePenLine } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { RiskBadge, ScopeBadge, StatusBadge } from "@/components/ui/Badge";
import { formatDate, addDaysIso } from "@/lib/date";
import { sourceTypeLabels } from "@/lib/labels";
import { supabase } from "@/lib/supabase";
import type { Task } from "@/lib/types";

export function TaskCard({
  task,
  onChanged,
  onEdit,
  prominent = false
}: {
  task: Task;
  onChanged: () => void;
  onEdit?: (task: Task) => void;
  prominent?: boolean;
}) {
  async function updateTask(values: Partial<Task>) {
    await supabase?.from("tasks").update(values).eq("id", task.id);
    onChanged();
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
      <div className="mt-4 grid gap-3 text-base text-slate-700 sm:grid-cols-2">
        <p className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-indigo-600" />
          到期：{formatDate(task.due_date)}
        </p>
        <p>跟進：{formatDate(task.follow_up_date)}</p>
        <p className="sm:col-span-2">
          <span className="font-semibold">下一步：</span>
          {task.next_action}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="success" onClick={() => updateTask({ status: "done" })}>
          完成
        </Button>
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
        <Button variant="ghost" onClick={() => updateTask({ archived_at: new Date().toISOString() })}>
          封存
        </Button>
      </div>
    </article>
  );
}
