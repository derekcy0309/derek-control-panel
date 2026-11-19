import { briefDate, type DashboardBrief } from "./calendar-brief.ts";

// Read the same snapshot the day cards display. No request, reclassification, or task creation.
export function dashboardAgendaHighlights(brief:DashboardBrief){
  const now=Date.parse(brief.generatedAt);
  if(!Number.isFinite(now))return null;
  const today=briefDate(new Date(now));
  for (const day of brief.days) {
    if(day.date<today)continue;
    const live=day.events.filter(e=>e.allDay || Date.parse(e.end)>now || (e.start===e.end && Date.parse(e.start)>=now));
    // A background all-day appointment should not hide the next timed appointment today.
    const event=live.filter(e=>!e.allDay).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))[0]??live[0];
    if(event)return {event,date:day.date};
  }
  return null;
}
