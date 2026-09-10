export type RoutineIntervalUnit = "day" | "month" | "year";

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
