import { addBriefDays, briefDate, type DashboardBrief } from "./calendar-brief.ts";

const weekdays = "日一二三四五六";
const palettes = ["almond", "mist", "mint", "mauve"] as const;
const dayMs = 86400000;
function midnight(iso: string) { return Date.parse(iso + "T00:00:00Z"); }
export function daylineDate(iso: string, long = false) {
  const t = midnight(iso), d = new Date(t);
  if (!Number.isFinite(t)) return "日期未定";
  const date = (d.getUTCMonth() + 1) + "月" + d.getUTCDate() + "日";
  return long ? d.getUTCFullYear() + "年" + date + "（星期" + weekdays[d.getUTCDay()] + "）" : date + "（" + weekdays[d.getUTCDay()] + "）";
}
// Hong Kong civil dates, anchored on a Monday. Never reset mid-week at a year boundary.
export function daylineWeek(iso = briefDate()) {
  const n = Math.floor((midnight(iso) - midnight("2026-11-09")) / (7 * dayMs));
  return palettes[((n % 4) + 4) % 4] ?? "mist";
}
export function nextHkMidnight(now: Date) { return Date.parse(addBriefDays(briefDate(now),1) + "T00:00:00+08:00"); }

// A multi-day appointment belongs on the first visible day once, with its original range.
// Never merge distinct occurrences simply because the person gave them the same title.
export function visibleAgendaDays(days:DashboardBrief["days"]) {
  const seen=new Set<string>();
  return days.map(day=>({...day,events:day.events.filter(event=>{
    const key=JSON.stringify([event.uid,event.start]);if(seen.has(key))return false;seen.add(key);return true;
  })}));
}
