import { addDays, addMonths, differenceInCalendarDays, format, getDate, isBefore, parseISO, startOfDay, startOfMonth } from "date-fns";

export const todayIso = () => format(new Date(), "yyyy-MM-dd");
export const currentMonth = () => format(new Date(), "yyyy-MM-01");

// From the 27th onward, personal finance opens the next month's planning view.
// The supplied date keeps the boundary deterministic in tests.
export function cashflowDefaultMonth(now = new Date()) {
  const target = getDate(now) >= 27 ? addMonths(now, 1) : now;
  return format(startOfMonth(target), "yyyy-MM-01");
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
