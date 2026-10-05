const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateTaskWorkSchedule(input: {
  startDate: unknown;
  dueDate: unknown;
  workDates: unknown;
}): { startDate: string | null; workDates: string[] | null; error: string | null } {
  const startDate = input.startDate == null || input.startDate === "" ? null : input.startDate;
  const dueDate = input.dueDate == null || input.dueDate === "" ? null : input.dueDate;
  const workDates = input.workDates === null || input.workDates === undefined ? null : input.workDates;
  if (startDate === null && workDates === null) return { startDate: null, workDates: null, error: null };
  if (!isCalendarDate(startDate)) {
    return { startDate: null, workDates: null, error: "請設定有效的任務開始日。" };
  }
  if (dueDate !== null && !isCalendarDate(dueDate)) {
    return { startDate: null, workDates: null, error: "請設定有效的完成日，或清除完成日。" };
  }
  if (dueDate !== null && startDate > dueDate) return { startDate: null, workDates: null, error: "開始日不可遲過完成日。" };
  if (!Array.isArray(workDates) || workDates.length < 1 || workDates.length > 90) {
    return { startDate: null, workDates: null, error: "請揀 1 至 90 個真正要做的日子。" };
  }
  if (workDates.some((date) => !isCalendarDate(date))) {
    return { startDate: null, workDates: null, error: "請選擇有效的工作日。" };
  }
  if (workDates.some((date) => date < startDate)) {
    return { startDate: null, workDates: null, error: `工作日不可早過開始日 ${startDate}；請修改開始日或移除該工作日。` };
  }
  if (dueDate !== null && workDates.some((date) => date > dueDate)) {
    return { startDate: null, workDates: null, error: `工作日不可遲過完成日 ${dueDate}；請修改完成日或移除該工作日。` };
  }
  const uniqueDates = [...new Set(workDates)].sort();
  if (uniqueDates.length !== workDates.length) {
    return { startDate: null, workDates: null, error: "同一日只需要揀一次。" };
  }
  return { startDate, workDates: uniqueDates, error: null };
}

/** An unfilled optional deadline must never silently disable the date picker. */
export function addTaskWorkDate(input: {
  startDate: string;
  dueDate: string;
  workDates: string[];
  date: string;
}): { startDate: string; workDates: string[]; error: string | null } {
  const unchanged = { startDate: input.startDate, workDates: input.workDates };
  if (!isCalendarDate(input.date)) return { ...unchanged, error: "請先揀一個要做的日子，再按「加入」。" };
  if (input.workDates.includes(input.date)) return { ...unchanged, error: `${input.date} 已在下方清單，不需要重複加入。` };
  const startDate = input.startDate || [...input.workDates, input.date].sort()[0];
  const result = validateTaskWorkSchedule({ startDate, dueDate: input.dueDate, workDates: [...input.workDates, input.date] });
  if (result.error) return { ...unchanged, error: result.error };
  return { startDate, workDates: result.workDates!, error: null };
}

export function taskScheduledForDate(task: { work_dates?: string[] | null }, date: string) {
  return !task.work_dates?.length || task.work_dates.includes(date);
}
