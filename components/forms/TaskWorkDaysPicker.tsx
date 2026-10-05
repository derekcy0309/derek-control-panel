"use client";

import { useState } from "react";
import { isCalendarDate } from "@/lib/task-work-schedule";

export function TaskWorkDaysPicker({
  startDate,
  dueDate,
  workDates,
  onChange,
  disabled = false
}: {
  startDate: string;
  dueDate: string;
  workDates: string[];
  onChange: (startDate: string, workDates: string[]) => void;
  disabled?: boolean;
}) {
  const [nextDate, setNextDate] = useState("");
  const validNext = isCalendarDate(nextDate) && nextDate >= startDate && nextDate <= dueDate;

  return (
    <fieldset className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4" disabled={disabled}>
      <legend className="px-1 font-extrabold text-slate-900">邊幾日提醒我做？</legend>
      <p className="mt-1 text-sm leading-6 text-slate-600">先揀開始日及上面的完成日，再逐日加入。只有揀咗的日子先會自動出現在今日建議及發工作提醒。</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>
          <span className="label">任務開始日</span>
          <input className="field mt-2 bg-white" type="date" value={startDate} max={dueDate || undefined} onChange={(event) => {
            const value = event.target.value;
            onChange(value, workDates.filter((date) => date >= value));
          }} />
        </label>
        <label>
          <span className="label">要做的日子</span>
          <span className="mt-2 flex gap-2">
            <input className="field min-w-0 bg-white" type="date" aria-label="加入要做的日子" min={startDate || undefined} max={dueDate || undefined} value={nextDate} onChange={(event) => setNextDate(event.target.value)} />
            <button className="min-h-11 shrink-0 rounded-lg bg-indigo-600 px-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={!startDate || !dueDate || !validNext || workDates.includes(nextDate)} onClick={() => {
              onChange(startDate, [...workDates, nextDate].sort());
              setNextDate("");
            }}>加入</button>
          </span>
        </label>
      </div>
      {startDate && dueDate && !workDates.includes(dueDate) ? <button className="mt-3 min-h-10 rounded-lg border border-indigo-200 bg-white px-3 text-sm font-bold text-indigo-700" type="button" onClick={() => onChange(startDate, [...workDates, dueDate].sort())}>＋完成日都要做</button> : null}
      {workDates.length ? (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="已選工作日">
          {workDates.map((date) => <button key={date} type="button" className="min-h-10 rounded-full bg-white px-3 text-sm font-bold text-indigo-800 ring-1 ring-indigo-200" onClick={() => onChange(startDate, workDates.filter((item) => item !== date))} aria-label={`移除 ${date}`} title="按下移除">{date} ×</button>)}
        </div>
      ) : startDate ? <p className="mt-3 text-sm font-semibold text-amber-800">請加入最少一個要做的日子，未選的日子不會自動提醒。</p> : null}
      {startDate ? <button type="button" className="mt-3 text-sm font-bold text-slate-600 underline" onClick={() => onChange("", [])}>取消自訂工作日，恢復一般限期提醒</button> : null}
    </fieldset>
  );
}
