export type WeeklyCapacityAssessment = {
  knownEstimatedMinutes: number;
  availableMinutes: number | null;
  remainingMinutes: number | null;
  level: "unknown" | "within_capacity" | "tight" | "over_capacity";
};

export function weekStartForDate(date: string) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || formatIsoDate(parsed) !== date) return null;
  const mondayOffset = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - mondayOffset);
  return formatIsoDate(parsed);
}

export function addCalendarDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || formatIsoDate(parsed) !== date || !Number.isInteger(days)) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return formatIsoDate(parsed);
}

export function assessWeeklyCapacity(knownEstimatedMinutes: number, availableMinutes: number | null): WeeklyCapacityAssessment {
  const estimate = Number.isFinite(knownEstimatedMinutes) ? Math.max(0, Math.round(knownEstimatedMinutes)) : 0;
  if (availableMinutes === null || !Number.isFinite(availableMinutes)) {
    return { knownEstimatedMinutes: estimate, availableMinutes: null, remainingMinutes: null, level: "unknown" };
  }
  const capacity = Math.max(0, Math.round(availableMinutes));
  const remaining = capacity - estimate;
  const level = remaining < 0
    ? "over_capacity"
    : capacity > 0 && remaining / capacity <= 0.15
      ? "tight"
      : "within_capacity";
  return { knownEstimatedMinutes: estimate, availableMinutes: capacity, remainingMinutes: remaining, level };
}

export function normalizeWeeklyOutcomes(values: unknown[]) {
  return values
    .map((value) => typeof value === "string" ? value.trim().slice(0, 500) : "")
    .filter(Boolean)
    .slice(0, 3);
}

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
