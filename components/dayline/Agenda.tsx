import Link from "next/link";
import { Bookmark, CalendarDays, RefreshCw } from "lucide-react";
import { addBriefDays, briefDate, briefEventTime, briefTime, type BriefEvent, type BriefSource, type DashboardBrief } from "@/lib/calendar-brief";
import { daylineDate, visibleAgendaDays } from "@/lib/dayline";
import { calendarErrorMessage } from "@/lib/calendar-errors";
import { WorkStopHint } from "@/components/WorkStopHint";
import type { StopSnapshot } from "@/lib/work-stop";

const WORK_GOOGLE = "工作 · Google";

type Row={id:string; title:string; stamp:string; group:string; info:string; href?:string; due?:boolean; family?:boolean};
function eventRow(e:BriefEvent,date:string,now:number):Row {
  const multi=e.allDay?addBriefDays(e.end.slice(0,10),-1)!==e.start.slice(0,10):briefDate(new Date(e.start))!==briefDate(new Date(e.end));
  const time=briefEventTime(e).replace(/\d{4}-\d{2}-\d{2}/g,x=>daylineDate(x,e.start.slice(0,4)!==e.end.slice(0,4)));
  const ongoing=!e.allDay&&Date.parse(e.start)<now&&Date.parse(e.end)>now;
  const group=e.source===WORK_GOOGLE?WORK_GOOGLE:e.family?"家庭":e.source==="Apple"?"iPhone":"日曆";
  return {id:e.source+":"+e.id+":"+e.start,title:e.title,stamp:e.allDay?"全日":ongoing?"進行中":briefTime(e.start),group,family:e.family,
    info:(e.tentative?"待確認":"行程")+(multi||ongoing?" · "+time:!e.allDay&&e.start!==e.end?" · 至 "+briefTime(e.end):"")+(e.source!=="Panel"?" · 唯讀":""),
    href:e.source==="Panel"?"/calendar?date="+date:undefined};
}
function Line({row}:{row:Row}){
  const body=<><span className="dl-stamp">{row.stamp}</span><span className="dl-event-copy"><strong>{row.title}</strong><span className="dl-chips"><b className={"dl-badge "+(row.family?"dl-family":"dl-school")}>{row.group}</b><span>{row.info}</span></span></span><span className="dl-node" aria-hidden="true"/></>;
  return <div className={"dl-event"+(row.due?" dl-deadline":"")}>{row.href?<Link href={row.href}>{body}</Link>:<div>{body}</div>}</div>;
}
function Day({day,brief}:{day:DashboardBrief["days"][number];brief:DashboardBrief}){
  const date=day.date;
  const now=Date.parse(brief.generatedAt),today=briefDate(new Date(now));
  const earlier=(e:BriefEvent)=>!e.allDay&&date===today&&Date.parse(e.end)<now;
  const events=day.events.filter(e=>!earlier(e)).sort((a,b)=>Number(a.allDay)-Number(b.allDay)||a.start.localeCompare(b.start));
  const rows:Row[]=[...events.map(e=>eventRow(e,date,now)),...(brief.familyDates??[]).filter(f=>f.date===date).map(f=>({id:"family:"+f.id,title:f.title,stamp:"限期",group:f.kind==="school"?"學校":"家庭",family:f.kind==="family",info:"日期／限期",due:true,href:"/workspace/"+f.kind+"#item-"+f.id})),...day.deadlines.map(t=>({id:"task:"+t.id,title:t.title,stamp:"限期",group:"Task",info:"當日截止",due:true,href:"/tasks/"+t.id}))];
  const past=day.events.filter(earlier).map(e=>eventRow(e,date,now));
  if(!rows.length&&!past.length)return null;
  // Keep the next timed event AND nearest deadline in view without opening the rest.
  const primary=rows.slice(0,3),due=rows.find(x=>x.due);
  if(due&&!primary.some(x=>x.due)&&primary.length===3)primary[2]=due;
  const rest=rows.filter(x=>!primary.includes(x));
  return <section aria-label={daylineDate(date)}><div className="dl-dayline"><span>{date===today?"今日":date===addBriefDays(today,1)?"明天":date===addBriefDays(today,2)?"後天":"日期"}</span><time dateTime={date}>{daylineDate(date)}</time></div>
    <div className="dl-rail">{primary.map(x=><Line key={x.id} row={x}/>)}</div>
    {rest.length||past.length?<details className="dl-more-rows"><summary>{rest.length?"其餘安排（"+rest.length+"）":""}{rest.length&&past.length?" · ":""}{past.length?"已過時間（"+past.length+"）":""}</summary><div className="dl-rail">{[...rest,...past].map(x=><Line key={x.id} row={x}/>)}</div></details>:null}
  </section>;
}

function GoogleAgendaNotice({source}:{source:BriefSource}) {
  const errorCode:string|undefined=source.errorCode;
  if(source.state==="fresh")return null;
  const message=source.state==="not_connected"?"未連接工作 Google 日曆。"
    :source.state==="select_calendars"?"尚未選擇要顯示的工作 Google 日曆。"
    :errorCode==="GOOGLE_RECONNECT"?"授權已失效，請重新連接。"
    :"暫時未能讀取，請稍後按「更新」再試。";
  return <p role={source.state==="stale"?"alert":"status"} className="dl-agenda-state">{WORK_GOOGLE}：{message} <Link className="underline" href="/settings#google-calendar">Google Calendar 設定</Link></p>;
}

export function DaylineAgenda({brief,error,busy,reload,stop,userId}:{brief:DashboardBrief|null;error:string;busy:boolean;reload:()=>void;stop:StopSnapshot|null;userId:string}){
  const any=brief&&brief.days.some(d=>d.events.length||d.deadlines.length||(brief.familyDates??[]).some(f=>f.date===d.date));
  const school=brief?.nextSchoolDate;
  const google=brief?.sources.find(s=>s.label===WORK_GOOGLE);
  const hasGoogleEvents=brief?.days.some(d=>d.events.some(e=>e.source===WORK_GOOGLE));
  return <section className="dl-agenda" aria-labelledby="private-brief-title">
    <div className="dl-section-heading"><div><span className="dl-eyebrow" aria-hidden="true"><b/>AGENDA · 未來三日</span><h2 id="private-brief-title">行程及限期</h2></div><div className="dl-agenda-actions"><Link className="dl-text-btn" href="/calendar">日曆 →</Link><button type="button" onClick={reload} disabled={busy} className="dl-agenda-refresh" aria-label="更新行程及限期"><RefreshCw aria-hidden="true"/>{busy?"讀取中":"更新"}</button></div></div>
    {busy&&!brief?<p role="status" className="dl-agenda-state">正在讀取未來三日的安排…</p>:null}
    {error?<p role="alert" className="dl-agenda-state">{error} {brief?"以下保留上次結果。":""}</p>:null}
    {brief?<>{brief.sources.filter(s=>s.state==="stale"&&s.label!==WORK_GOOGLE).map(s=><p key={s.label} role="alert" className="dl-agenda-state">{s.label} 未能更新。{calendarErrorMessage(s.errorCode)}{s.lastSync?" 上次更新："+daylineDate(briefDate(new Date(s.lastSync)),true)+" "+briefTime(s.lastSync):""}</p>)}
      {google?<GoogleAgendaNotice source={google}/>:null}
      {brief.familyWarning?<p role="alert" className="dl-agenda-state">{brief.familyWarning}</p>:null}
      {brief.truncated?<p role="status" className="dl-agenda-state">未能列出全部安排；完整清單可到日曆或任務查看。{google?" 工作行程請於 Google 日曆查看。":""}</p>:null}
      {any?visibleAgendaDays(brief.days).map(day=><Day key={day.date} day={day} brief={brief}/>):<p className="dl-agenda-state">根據已讀取的資料，未來三日暫無行程或限期。</p>}
      {school?<div className="dl-later"><Bookmark aria-hidden="true"/><div><span>三日以外 · 下一個學校限期</span><Link href={"/workspace/school#item-"+school.id}><time dateTime={school.date}>{daylineDate(school.date)}</time>　{school.title}</Link></div></div>:null}
      {brief.nextSchoolWarning?<p className="dl-agenda-state">暫時未能讀取三日後的學校限期。 <Link href="/workspace/school" className="underline">查看子女及學校</Link></p>:null}
      {brief.warnings?.map(w=><p className="dl-agenda-state" key={w} role="status">{w}</p>)}
      {stop?<details className="dl-context"><summary>建議停止工作時間及出門準備</summary><WorkStopHint key={userId} userId={userId} snapshot={error?{...stop,incomplete:true}:stop}/></details>:null}
      <details className="dl-context">
        <summary><CalendarDays aria-hidden="true"/>　日曆來源及設定</summary>
        {brief.sources.map(s=><p key={s.label} className="dl-agenda-state">{s.label}：{s.state==="fresh"?(s.label===WORK_GOOGLE&&!hasGoogleEvents?"已更新，未來三日暫無工作行程":"已更新"):s.state==="not_connected"?"未連接":s.state==="select_calendars"?"尚未選擇日曆":"未能更新"}{s.lastSync?" · "+daylineDate(briefDate(new Date(s.lastSync)))+" "+briefTime(s.lastSync):""}</p>)}
        <p className="dl-agenda-state">已選擇的 iCloud 行程會自動顯示。如需修改，請在 iPhone 編輯。 <Link className="underline" href="/settings#private-calendar">私人日曆設定</Link></p>
        <p className="dl-agenda-state">工作行程只會在你的首頁顯示。如需修改，請在 Google 日曆編輯。 <Link className="underline" href="/settings#google-calendar">工作 Google Calendar 設定</Link></p>
      </details>
    </>:null}
  </section>;
}
