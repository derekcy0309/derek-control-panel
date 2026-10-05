"use client";

import { useId, useState } from "react";
import { addTaskWorkDate, isCalendarDate, validateTaskWorkSchedule } from "@/lib/task-work-schedule";

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
  const [feedback, setFeedback] = useState("");
  const [addError, setAddError] = useState("");
  const messageId = useId();
  const scheduleError = workDates.length ? validateTaskWorkSchedule({ startDate, dueDate, workDates }).error : null;
  const error = addError || scheduleError;

  function addDate(date: string) {
    const result = addTaskWorkDate({ startDate, dueDate, workDates, date });
    setAddError(result.error || "");
    if (result.error) { setFeedback(""); return; }
    onChange(result.startDate, result.workDates);
    setNextDate("");
    setFeedback(`已加入 ${date}；儲存任務後才會啟用提醒。`);
  }

  return (
    <fieldset className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4" disabled={disabled}>
      <legend className="px-1 font-extrabold text-slate-900">邊幾日提醒我做？</legend>
      <p className="mt-1 text-sm leading-6 text-slate-600">揀要做的日子，再按「加入」。完成日可留空；沒有填開始日會用第一個加入的日子。只有清單內的日子會自動出現在今日建議及發工作提醒。</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>
          <span className="label">任務開始日</span>
          <input className="field mt-2 bg-white" type="date" value={startDate} onChange={(event) => {
            const value = event.target.value;
            setAddError("");
            setFeedback("");
            onChange(value || workDates[0] || "", workDates);
          }} />
        </label>
        <label>
          <span className="label">要做的日子</span>
          <span className="mt-2 flex gap-2">
            <input className="field min-w-0 bg-white" type="date" aria-label="加入要做的日子" aria-describedby={messageId} aria-invalid={Boolean(addError)} value={nextDate} onChange={(event) => {
              setNextDate(event.target.value);
              setAddError("");
              setFeedback("");
            }} onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); addDate(nextDate); }
            }} />
            <button className="min-h-11 shrink-0 rounded-lg bg-indigo-600 px-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => addDate(nextDate)}>加入</button>
          </span>
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-600">{dueDate ? `完成日：${dueDate}（可在上面的「完成／截止日」修改）` : "未設完成日，仍可加入工作日。"}</p>
      <div id={messageId}>
        {error ? <p className="mt-3 text-sm font-semibold text-amber-800" role="alert">{error}</p> : null}
        {feedback && !error ? <p className="mt-3 text-sm font-semibold text-indigo-800" role="status">{feedback}</p> : null}
      </div>
      {isCalendarDate(dueDate) && !workDates.includes(dueDate) ? <button className="mt-3 min-h-10 rounded-lg border border-indigo-200 bg-white px-3 text-sm font-bold text-indigo-700" type="button" onClick={() => addDate(dueDate)}>＋完成日都要做</button> : null}
      {workDates.length ? (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="已選工作日">
          {workDates.map((date) => <button key={date} type="button" className="min-h-11 rounded-full bg-white px-3 text-sm font-bold text-indigo-800 ring-1 ring-indigo-200" onClick={() => {
            setAddError("");
            setFeedback("");
            onChange(startDate, workDates.filter((item) => item !== date));
          }} aria-label={`移除 ${date}`} title="按下移除">{date} ×</button>)}
        </div>
      ) : startDate ? <p className="mt-3 text-sm font-semibold text-amber-800">請加入最少一個要做的日子，未選的日子不會自動提醒。</p> : null}
      {startDate || workDates.length ? <button type="button" className="mt-3 min-h-11 text-sm font-bold text-slate-600 underline" onClick={() => {
        setNextDate(""); setAddError(""); setFeedback(""); onChange("", []);
      }}>取消自訂工作日，恢復一般限期提醒</button> : null}
    </fieldset>
  );
}
