export type RoutineIntervalUnit = "day" | "month" | "year";

export const routineWeekdays = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" }
] as const;

export function addRoutineInterval(date: string, interval: number, unit: RoutineIntervalUnit) {
  const parts = date.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part)) || !Number.isInteger(interval) || interval < 1) {
    return null;
  }

  const [year, month, day] = parts;
  const source = new Date(Date.UTC(year, month - 1, day));
  if (
    source.getUTCFullYear() !== year
    || source.getUTCMonth() !== month - 1
    || source.getUTCDate() !== day
  ) return null;

  if (unit === "day") source.setUTCDate(source.getUTCDate() + interval);
  else {
    const monthOffset = unit === "year" ? interval * 12 : interval;
    const targetMonthStart = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
    const targetLastDay = new Date(Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth() + 1,
      0
    )).getUTCDate();
    source.setUTCFullYear(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth(), Math.min(day, targetLastDay));
  }

  return source.toISOString().slice(0, 10);
}

export function formatRoutineDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function nextRoutineWeeklyDate(date: string, weekdays: number[]) {
  const parts = date.split("-").map(Number);
  const selectedDays = new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  if (parts.length !== 3 || selectedDays.size === 0) return null;
  const [year, month, day] = parts;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  for (let offset = 1; offset <= 7; offset += 1) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
    if (selectedDays.has(candidate.getUTCDay())) return candidate.toISOString().slice(0, 10);
  }
  return null;
}
