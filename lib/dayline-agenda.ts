import { addBriefDays, briefDate, briefEventOnDate, briefEventTime, briefTime, type BriefEvent, type DashboardBrief } from "./calendar-brief.ts";
import { appleCalendarMonthWindow, type AppleCalendarMonth } from "./apple-calendar-month.ts";
import { daylineDate } from "./dayline.ts";
import type { OperatingItem, Task } from "./types.ts";

type CalendarTask = Pick<Task, "id" | "due_date" | "title">;
type CalendarItem = Pick<OperatingItem, "id" | "due_date" | "title" | "item_type" | "area" | "metadata" | "owner_id" | "schedule_start_at" | "schedule_end_at" | "schedule_status">;
export type AgendaKind = "schedule" | "school" | "deadline" | "family" | "item";
export type MonthAgendaRow = { id:string; kind:AgendaKind; title:string; detail:string; when:string; href?:string; start?:string };

export function calendarMonday(date: string) {
  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  return addBriefDays(date, -((weekday + 6) % 7));
}

export function calendarMonth(date: string) {
  const month = date.slice(0,7);
  const window=appleCalendarMonthWindow(month);
  if(!window)return {month,dates:[] as string[]};
  const dates:string[] = [];
  for (let day=window.from;day<window.until;day=addBriefDays(day,1)) dates.push(day);
  return { month, dates };
}

function storedTime(value: string | null | undefined) {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? briefTime(value!) : null;
}

export function makeMonthAgenda(tasks:CalendarTask[], items:CalendarItem[], viewerId:string, brief:DashboardBrief|null, appleMonth:AppleCalendarMonth|null=null) {
  const byDate = new Map<string, MonthAgendaRow[]>();
  function append(date:string, row:MonthAgendaRow) {
    const prior = byDate.get(date);
    if(prior)prior.push(row);
    else byDate.set(date,[row]);
  }
  const localIds=new Set<string>();
  for(const item of items){
    if(!item.due_date)continue;
    localIds.add(item.id);
    const busy=item.metadata.calendarPrivacy === "busy" && item.owner_id !== viewerId;
    const start=item.item_type==="event" ? storedTime(item.schedule_start_at) : null;
    const end=start ? storedTime(item.schedule_end_at) : null;
    const kind:AgendaKind=item.item_type==="school"?"school":item.item_type==="event"?"schedule":item.area==="family"?"family":"item";
    append(item.due_date,{id:"panel:"+item.id,kind,title:busy?"忙碌":item.title,
      when:start?(end&&end!==start?start+"–"+end:start):kind==="schedule"?"全日":"指定日期",
      detail:busy?"只顯示忙碌":kind==="school"?"子女及學校":kind==="family"?"家庭":kind==="schedule"&&item.schedule_status==="confirmed"?"已確認":kind==="schedule"?"未確認":"Panel",start:start??undefined,
      href:busy?undefined:kind==="school"?"/workspace/school#item-"+item.id:undefined});
  }
  for(const task of tasks){
    if(task.due_date)append(task.due_date,{id:"task:"+task.id,kind:"deadline",title:task.title,when:"限期",detail:"Task Deadline",href:"/tasks/"+task.id});
  }
  const seenByDate=new Map<string,Set<string>>();
  function appendEvent(date:string,event:BriefEvent){
    if(event.source==="Panel" && localIds.has(event.id))return;
    const key=event.source+":"+event.uid+":"+event.start;
    let seen=seenByDate.get(date);
    if(!seen){seen=new Set();seenByDate.set(date,seen);}
    if(seen.has(key))return;
    seen.add(key);
    const when=briefEventTime(event).replace(/\d{4}-\d{2}-\d{2}/g,d=>daylineDate(d,event.start.slice(0,4)!==event.end.slice(0,4)));
    append(date,{id:key,kind:"schedule",title:event.title,when,detail:event.source==="Apple"?"iPhone · 唯讀":event.tentative?"待確認":"已確認",start:event.allDay?undefined:briefTime(event.start)});
  }
  // If a brief is passed, keep its fixed owner-scoped dates and skip Panel
  // rows already present in the user's regular workspace data.
  for(const day of brief?.days??[]){
    for(const event of day.events)appendEvent(day.date,event);
  }
  if(appleMonth?.source.state==="fresh"){
    // Apple remains a separate read-only source; no linked Task or shared item.
    const events=appleMonth.events.filter(event=>event.source==="Apple");
    for(const date of calendarMonth(appleMonth.month+"-01").dates){
      for(const event of events)if(briefEventOnDate(event,date))appendEvent(date,event);
    }
  }
  for(const row of [...(brief?.familyDates??[]),...(brief?.nextSchoolDate?[brief.nextSchoolDate]:[])]){
    if(localIds.has(row.id))continue;
    localIds.add(row.id);
    append(row.date,{id:"family:"+row.id,kind:row.kind,title:row.title,when:"指定日期",detail:row.kind==="school"?"子女及學校":"家庭",href:"/workspace/"+row.kind+"#item-"+row.id});
  }
  for(const list of byDate.values())list.sort((a,b)=>Number(!a.start)-Number(!b.start)||(a.start??"").localeCompare(b.start??""));
  return byDate;
}

export function validCalendarDate(date: string | null) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !appleCalendarMonthWindow(date.slice(0,7))) return null;
  const instant = new Date(date + "T12:00:00+08:00");
  return Number.isFinite(instant.getTime()) && briefDate(instant) === date ? date : null;
}
