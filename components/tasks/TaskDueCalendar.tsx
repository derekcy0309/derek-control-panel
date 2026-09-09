"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Task } from "@/lib/types";

export function TaskDueCalendar({ tasks, today }: { tasks: Task[]; today: string }) {
  const initialYear = Number(today.slice(0, 4));
  const initialMonth = Number(today.slice(5, 7)) - 1;
  const [cursor, setCursor] = useState({ year: initialYear, month: initialMonth });
  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`;
  const firstWeekday = new Date(Date.UTC(cursor.year, cursor.month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
  const cells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => index < firstWeekday ? null : index - firstWeekday + 1);
  const monthTasks = useMemo(
    () => tasks.filter((task) => task.due_date?.startsWith(monthPrefix)).sort((left, right) => (left.due_date ?? "").localeCompare(right.due_date ?? "") || left.title.localeCompare(right.title)),
    [monthPrefix, tasks]
  );
  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of monthTasks) {
      if (!task.due_date) continue;
      const existing = grouped.get(task.due_date) ?? [];
      existing.push(task);
      grouped.set(task.due_date, existing);
    }
    return grouped;
  }, [monthTasks]);

  function moveMonth(amount: number) {
    setCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.month + amount, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  }

  return (
    <section className="task-due-calendar panel overflow-hidden">
      <header className="task-due-calendar-header flex items-center justify-between border-b border-slate-200 p-4">
        <button type="button" className="icon-button" onClick={() => moveMonth(-1)} aria-label="上個月"><ChevronLeft className="h-5 w-5" /></button>
        <div className="text-center">
          <h2 className="font-extrabold text-slate-950">到期任務日曆</h2>
          <p className="mt-0.5 text-xs font-semibold text-slate-600">{cursor.year} 年 {cursor.month + 1} 月</p>
        </div>
        <button type="button" className="icon-button" onClick={() => moveMonth(1)} aria-label="下個月"><ChevronRight className="h-5 w-5" /></button>
      </header>
      <div className="hidden grid-cols-7 border-b border-slate-200 text-center text-xs font-extrabold text-slate-500 sm:grid">
        {"日一二三四五六".split("").map((day) => <div key={day} className="py-2">{day}</div>)}
      </div>
      <div className="hidden grid-cols-7 sm:grid">
        {cells.map((day, index) => {
          const date = day ? `${monthPrefix}-${String(day).padStart(2, "0")}` : "";
          const dayTasks = tasksByDate.get(date) ?? [];
          return (
            <div key={`${monthPrefix}-${index}`} className={`min-h-28 border-b border-r border-slate-100 p-2 ${date === today ? "bg-indigo-50/60" : "bg-white"}`}>
              {day ? (
                <>
                  <p className={`text-xs font-extrabold ${date === today ? "text-indigo-700" : "text-slate-500"}`}>{day}</p>
                  <div className="mt-1 grid gap-1">
                    {dayTasks.slice(0, 3).map((task) => (
                      <Link key={task.id} href={`/tasks/${task.id}`} className={`truncate rounded-md px-2 py-1 text-xs font-bold ${calendarTone(task, today)}`} title={task.title}>
                        {task.title}
                      </Link>
                    ))}
                    {dayTasks.length > 3 ? <p className="px-1 text-[11px] font-extrabold text-slate-500">另有 +{dayTasks.length - 3} 項</p> : null}
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="divide-y divide-slate-100 sm:hidden">
        {monthTasks.length ? monthTasks.map((task) => (
          <Link key={task.id} href={`/tasks/${task.id}`} className="flex min-h-14 items-center gap-3 p-4 hover:bg-slate-50">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-extrabold ${calendarTone(task, today)}`}>{task.due_date?.slice(8)}</span>
            <span className="min-w-0 font-bold text-slate-900">{task.title}</span>
          </Link>
        )) : <p className="p-6 text-center text-sm font-semibold text-slate-500">本月沒有到期任務。</p>}
      </div>
    </section>
  );
}

function calendarTone(task: Task, today: string) {
  if (!task.due_date) return "bg-slate-100 text-slate-700";
  if (task.due_date < today) return "bg-rose-100 text-rose-800";
  const day7 = shiftIsoDate(today, 7);
  const day14 = shiftIsoDate(today, 14);
  if (task.due_date <= day7) return "bg-amber-100 text-amber-900";
  if (task.due_date <= day14) return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-700";
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
