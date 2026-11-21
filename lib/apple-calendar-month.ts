import { addBriefDays, type BriefEvent, type BriefSource, type CalendarReadWindow } from "./calendar-brief.ts";

export type AppleCalendarMonthWindow = CalendarReadWindow & { month:string };
export type AppleCalendarMonth = Pick<AppleCalendarMonthWindow,"month"|"from"|"until"> & {
  events:BriefEvent[];
  source:BriefSource;
  truncated:boolean;
};

/** Only the displayed grid: month plus the two adjacent week rows if needed. */
export function appleCalendarMonthWindow(month:string|null):AppleCalendarMonthWindow|null {
  if(!month || !/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(month))return null;
  const year=Number(month.slice(0,4)),number=Number(month.slice(5));
  // Calendar input is bounded to normal real-world civil years and one grid.
  if(year<1900 || year>2199)return null;
  const monday=(date:string)=>addBriefDays(date,-((new Date(date+"T00:00:00Z").getUTCDay()+6)%7));
  const last=new Date(Date.UTC(year,number,0)).toISOString().slice(0,10);
  const from=monday(month+"-01"),until=addBriefDays(monday(last),7);
  return {month,from,until,start:from+"T00:00:00+08:00",end:until+"T00:00:00+08:00"};
}

export function requestedAppleCalendarMonth(params:URLSearchParams) {
  if([...params].length!==1 || !params.has("month"))return null;
  return appleCalendarMonthWindow(params.get("month"));
}
