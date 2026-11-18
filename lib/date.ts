import { addDays, differenceInCalendarDays, format, isBefore, parseISO, startOfDay } from "date-fns";

export const todayIso = () => format(new Date(), "yyyy-MM-dd");
export const currentMonth = () => format(new Date(), "yyyy-MM-01");

// From the 25th (Hong Kong time), cashflow opens the next month's view.
// Only the initial view changes; manual month selection and records are untouched.
export function cashflowDefaultMonth(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "numeric", day: "numeric"
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const monthIndex = Number(parts.month) - 1 + (Number(parts.day) >= 25 ? 1 : 0);
  return new Date(Date.UTC(Number(parts.year), monthIndex, 1)).toISOString().slice(0, 10);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "未設定";
  return format(parseISO(value), "yyyy-MM-dd");
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("zh-HK", {
    style: "currency",
    currency: "HKD",
    maximumFractionDigits: 0
  }).format(amount || 0);
}

export function daysFromToday(value: string | null | undefined) {
  if (!value) return null;
  return differenceInCalendarDays(parseISO(value), startOfDay(new Date()));
}

export function isOverdue(value: string | null | undefined) {
  if (!value) return false;
  return isBefore(parseISO(value), startOfDay(new Date()));
}

export function isWithinDays(value: string | null | undefined, days: number) {
  const diff = daysFromToday(value);
  return diff !== null && diff >= 0 && diff <= days;
}

export function addDaysIso(days: number) {
  return format(addDays(new Date(), days), "yyyy-MM-dd");
}

export function nextMonthDate(value: string | null) {
  const base = value ? parseISO(value) : new Date();
  return format(new Date(base.getFullYear(), base.getMonth() + 1, base.getDate()), "yyyy-MM-dd");
}
