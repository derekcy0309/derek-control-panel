import { bundledPublicHolidays, hkoLastBundledGregorianDate, hkoMonthStarts } from "./hong-kong-clock-calendar-data.ts";

export type HongKongClockCalendarDay = {
  date: string;
  lunarDate: string | null;
  holidayName: string | null;
};

const dayNames = [
  "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"
] as const;
const lunarDatePattern = /^閏?(?:正|[二三四五六七八九十]|十一|十二)月(?:初[一二三四五六七八九十]|十[一二三四五六七八九]|二十|廿[一二三四五六七八九]|三十)$/;
const msPerDay = 86_400_000;

export function isClockCalendarDate(value: string): boolean {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function bundledHongKongClockCalendar(date: string): HongKongClockCalendarDay {
  let lunarDate: string | null = null;
  if (!isClockCalendarDate(date)) return { date, lunarDate, holidayName: null };
  if (date <= hkoLastBundledGregorianDate) {
    const start = hkoMonthStarts.findLast(([day]) => day <= date);
    if (start) {
      const [startDate, month] = start;
      const day = dayNames[(Date.parse(date) - Date.parse(startDate)) / msPerDay];
      if (day) lunarDate = month + day;
    }
  }
  return { date, lunarDate, holidayName: bundledPublicHolidays[date] ?? null };
}

export function officialLunarDate(input: unknown): string | null {
  const date = (input as { LunarDate?: unknown } | null)?.LunarDate;
  return typeof date === "string" && lunarDatePattern.test(date) ? date : null;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const result = value.trim();
  return result.length > 0 && result.length <= 80 ? result : null;
}

export function officialPublicHolidays(input: unknown): Map<string, string> {
  const calendar = (input as { vcalendar?: Array<{ vevent?: unknown }> } | null)?.vcalendar;
  const events = Array.isArray(calendar) ? calendar[0]?.vevent : null;
  const dates = new Map<string, string>();
  if (!Array.isArray(events) || events.length > 150) return dates;
  for (const event of events) {
    if (!Array.isArray(event?.dtstart) || typeof event.dtstart[0] !== "string" || event.dtstart[1]?.value !== "DATE") continue;
    const date = event.dtstart[0].replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
    const name = cleanName(event.summary);
    if (isClockCalendarDate(date) && name && name !== "星期日") dates.set(date, name);
  }
  return dates;
}

export function parseHongKongClockCalendar(input: unknown, expectedDate: string): HongKongClockCalendarDay | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as { date?: unknown; lunarDate?: unknown; holidayName?: unknown };
  if (candidate.date !== expectedDate) return null;
  const lunarDate = officialLunarDate({ LunarDate: candidate.lunarDate });
  const holidayName = cleanName(candidate.holidayName);
  if ((!lunarDate && candidate.lunarDate !== null) || (!holidayName && candidate.holidayName !== null)) return null;
  return { date: expectedDate, lunarDate, holidayName };
}
