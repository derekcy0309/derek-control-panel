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
  const startDate = input.startDate === null || input.startDate === "" ? null : input.startDate;
  const dueDate = input.dueDate === null || input.dueDate === "" ? null : input.dueDate;
  const workDates = input.workDates === null || input.workDates === undefined ? null : input.workDates;
  if (startDate === null && workDates === null) return { startDate: null, workDates: null, error: null };
  if (!isCalendarDate(startDate) || !isCalendarDate(dueDate)) {
    return { startDate: null, workDates: null, error: "自訂工作日需要有效的開始日和完成日。" };
  }
  if (startDate > dueDate) return { startDate: null, workDates: null, error: "開始日不可遲過完成日。" };
  if (!Array.isArray(workDates) || workDates.length < 1 || workDates.length > 90) {
    return { startDate: null, workDates: null, error: "請揀 1 至 90 個真正要做的日子。" };
  }
  if (workDates.some((date) => !isCalendarDate(date) || date < startDate || date > dueDate)) {
    return { startDate: null, workDates: null, error: "要做的日子必須在開始日與完成日之間。" };
  }
  const uniqueDates = [...new Set(workDates)].sort();
  if (uniqueDates.length !== workDates.length) {
    return { startDate: null, workDates: null, error: "同一日只需要揀一次。" };
  }
  return { startDate, workDates: uniqueDates, error: null };
}

export function taskScheduledForDate(task: { work_dates?: string[] | null }, date: string) {
  return !task.work_dates?.length || task.work_dates.includes(date);
}
