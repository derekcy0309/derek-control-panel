export const briefTimezone = "Asia/Hong_Kong";
export type BriefEvent = { id: string; uid: string; title: string; start: string; end: string; allDay: boolean; source: "Apple" | "Panel"; tentative?: boolean };
export type BriefDeadline = { id: string; title: string; due: string; priority: number; status: string };
export type BriefSource = { label: string; state: "fresh" | "stale" | "not_connected" | "select_calendars"; lastSync: string | null };
export type CalendarBrief = { generatedAt: string; from: string; untilExclusive: string; days: { date: string; events: BriefEvent[]; deadlines: BriefDeadline[] }[]; sources: BriefSource[]; truncated: boolean; warnings?: string[]; text: string };
export function briefDate(value = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: briefTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value); }
export function addBriefDays(date: string, count: number) { return new Date(Date.parse(date + "T00:00:00Z") + count * 86400000).toISOString().slice(0, 10); }
export function briefWindow(now = new Date()) { const from = briefDate(now), until = addBriefDays(from, 3); return { from, until, start: from + "T00:00:00+08:00", end: until + "T00:00:00+08:00" }; }
export function briefTime(value: string) { return new Intl.DateTimeFormat("en-GB", { timeZone: briefTimezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)); }
// Do not make a multi-month source event look like an ordinary one-hour or
// single-day appointment on every day it overlaps. All-day DTEND is exclusive.
export function briefEventTime(event: BriefEvent) {
 if(event.allDay) {
  const start=event.start.slice(0,10),last=addBriefDays(event.end.slice(0,10),-1);
  return start===last?"全日":`全日 · ${start} 至 ${last}`;
 }
 const start=briefDate(new Date(event.start)),end=briefDate(new Date(event.end));
 return start===end?`${briefTime(event.start)}–${briefTime(event.end)}`:`${start} ${briefTime(event.start)} 至 ${end} ${briefTime(event.end)}`;
}
export function makeCalendarBrief(events: BriefEvent[], deadlines: BriefDeadline[], sources: BriefSource[], now = new Date(), truncated = false): CalendarBrief {
 const {from,until} = briefWindow(now);
 const unique = [...new Map(events.map(e => [e.uid + ":" + e.start, e])).values()];
 const days = [0,1,2].map(n => { const date=addBriefDays(from,n), dayStart=Date.parse(date+"T00:00:00+08:00"), dayEnd=dayStart+86400000;
  return { date, events:unique.filter(e => e.allDay ? e.start.slice(0,10)<=date && e.end.slice(0,10)>date : Date.parse(e.start)<dayEnd && Date.parse(e.end)>dayStart).sort((a,b)=>a.start.localeCompare(b.start)),
   deadlines:deadlines.filter(t=>t.due===date && !["done","cancelled"].includes(t.status)).sort((a,b)=>a.priority-b.priority || a.title.localeCompare(b.title)) }; });
 const longEvents=unique.filter(e=>Date.parse(e.end)-Date.parse(e.start)>31*86400000 && (e.allDay?e.start.slice(0,10)<until&&e.end.slice(0,10)>from:Date.parse(e.start)<Date.parse(until+"T00:00:00+08:00")&&Date.parse(e.end)>Date.parse(from+"T00:00:00+08:00")));
 const warnings=longEvents.length?[`有 ${longEvents.length} 個單次行程跨超過 31 日，請喺原本 Calendar 檢查「結束」日期（唔係「結束重複」）。Panel 保留來源資料，唔會自行更改。`]:[];
 const text = [`三日安排｜${from} 至 ${addBriefDays(from,2)}｜香港時間`, ...sources.filter(s=>s.state!=="fresh").map(s=>`注意：${s.label}${s.state==="not_connected"?"未連接":s.state==="select_calendars"?"未選 Calendar":"未能更新（可能不是最新）"}`),
  ...warnings.map(w=>`注意：${w}`),
  ...(truncated?["注意：資料超過本次上限，以下不是完整清單。"]:[]), ...days.flatMap((d,i)=>[`${["今日","聽日","後日"][i]} ${d.date}`,
   ...d.events.map(e=>`${briefEventTime(e)} ${e.title} [${e.source}${e.tentative?"・待確認":""}]`),
   ...d.deadlines.map(t=>`Deadline ${t.title} [${t.priority<=2?"P1":t.priority===3?"P2":"P3"}・${t.status==="waiting"?"等回覆":t.status==="blocked"?"待處理阻塞":t.status==="in_progress"?"做緊":"未完成"}]`),
   ...(!d.events.length&&!d.deadlines.length?["暫無已讀取的行程或 Deadline"]:[])])].join("\n");
 return { generatedAt:now.toISOString(),from,untilExclusive:until,days,sources,truncated,warnings,text };
}
