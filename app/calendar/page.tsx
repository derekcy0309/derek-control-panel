"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { daylineDate } from "@/lib/dayline";
import { addBriefDays, briefEventOnDate, briefTime } from "@/lib/calendar-brief";
import { appleCalendarMonthWindow, type AppleCalendarMonth } from "@/lib/apple-calendar-month";
import { calendarErrorMessage } from "@/lib/calendar-errors";
import { calendarMonday, calendarMonth, makeMonthAgenda, validCalendarDate, type MonthAgendaRow } from "@/lib/dayline-agenda";
import { useDaylineDate } from "@/hooks/useDaylineDate";
import { useControlData } from "@/hooks/useControlData";
import "../dayline-editorial-work.css";

export default function CalendarPage() { return <AuthGate><CalendarContent /></AuthGate>; }

const weekdays = ["一","二","三","四","五","六","日"];
const kindLabel = { schedule:"行程", school:"學校", deadline:"Deadline", family:"家庭", item:"項目" };

function CalendarContent() {
  const { data, loading, error, reload } = useControlData();
  const today = useDaylineDate();
  const [cursor,setCursor] = useState<string|null>(null);
  const [adding,setAdding] = useState(false);
  const [source,setSource] = useState<{ owner:string; month:string; run:number; result:AppleCalendarMonth|null; timedOut?:boolean }|null>(null);
  const [run,setRun]=useState(0);
  const owner=data?.currentUser.id;
  const selected=cursor??today;
  const {month,dates}=calendarMonth(selected);
  useEffect(()=>{setCursor(validCalendarDate(new URLSearchParams(window.location.search).get("date")));},[]);
  useEffect(()=>{
    if(!owner)return;
    const range=appleCalendarMonthWindow(month);
    if(!range){setSource({owner,month,run,result:null});return;}
    const controller=new AbortController();
    const timeout=window.setTimeout(()=>{
      if(controller.signal.aborted)return;
      setSource({owner,month,run,result:null,timedOut:true});
      controller.abort();
    },52000);
    void fetch("/api/apple-calendar-month?month="+encodeURIComponent(month),{cache:"no-store",credentials:"same-origin",signal:controller.signal})
      .then(async response=>{
        if(!response.ok)throw new Error("Calendar unavailable");
        const result:AppleCalendarMonth=await response.json();
        if(result.month!==month || result.from!==range.from || result.until!==range.until
          || !Array.isArray(result.events) || !["fresh","stale","not_connected","select_calendars"].includes(result.source?.state))
          throw new Error("Invalid calendar");
        if(!controller.signal.aborted)setSource({owner,month,run,result});
      })
      .catch(()=>{if(!controller.signal.aborted)setSource({owner,month,run,result:null});})
      .finally(()=>window.clearTimeout(timeout));
    return ()=>{window.clearTimeout(timeout);controller.abort();};
  },[owner,month,run,today]);
  const read=source?.owner===owner && source?.month===month ? source : null;
  const checking=!read || read.run!==run;
  const apple=read?.result;
  const agenda=useMemo(()=>data ? makeMonthAgenda(data.tasks,data.operatingItems,data.currentUser.id,null,apple??null):new Map<string,MonthAgendaRow[]>(),[data,apple]);
  if (loading || error || !data) return <LoadingState error={error} />;
  const weekStarts=calendarMonday(selected);
  const monthEntries=dates.filter(date=>date.startsWith(month)&&agenda.has(date));
  const selectedRows=agenda.get(selected)??[];
  const appleFresh=apple?.source.state==="fresh";
  const anyICloudInMonth=appleFresh && apple?.events.some(event=>dates.some(date=>date.startsWith(month)&&briefEventOnDate(event,date)));
  const selectedEmpty=checking ? "呢日暫時冇日序安排；iCloud 行程讀取中。"
    : appleFresh&&!apple?.truncated ? "呢日冇已讀取嘅行程或安排。"
    : "呢日暫時冇已讀取嘅安排；iCloud 結果可能未齊。";
  function moveMonth(offset:number){
    const next=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5))-1+offset,1)).toISOString().slice(0,10);
    if(validCalendarDate(next))setCursor(next.startsWith(today.slice(0,7))?today:next);
  }
  function moveWeek(offset:number){
    const next=validCalendarDate(addBriefDays(selected,offset*7));
    if(next)setCursor(next);
  }
  return <div className="dl-editorial-calendar">
    <header className="dl-intro dl-editorial-intro"><div><p className="dl-calendarline"><span className="dl-miniline"/>CALENDAR</p><h1>日曆</h1><p className="dl-editorial-welcome">一眼分清行程、學校安排同 Deadline。</p></div><button type="button" className="dl-add" onClick={()=>setAdding(true)}><Plus aria-hidden="true"/>新增日程</button></header>
    <section className="dl-calendar-icloud" aria-label="iPhone 行程來源">
      <div>
        <strong>iPhone 行程 <span>· iCloud Calendar</span></strong>
        <p className="dl-calendar-sources" role="status">{checking?"讀緊呢個月嘅 iCloud 行程…"
          :read?.timedOut?"讀取 iCloud 行程逾時，請稍後重試。"
          :!apple?"呢個月嘅 iCloud 行程未能讀取，請重試。"
          :apple.source.state==="not_connected"?"尚未連接 iCloud Calendar。"
          :apple.source.state==="select_calendars"?"已連接 iCloud，但未揀要顯示嘅 Calendar。"
          :apple.source.state==="stale"?calendarErrorMessage(apple.source.errorCode)
          :apple.truncated?"已讀取部分行程；原有 Calendar 有更多資料未列出。"
          :!anyICloudInMonth?"呢個月喺已揀嘅 iCloud Calendar 冇行程。"
          :`已讀取所選 iCloud Calendar${apple.source.lastSync?" · "+briefTime(apple.source.lastSync)+"（香港時間）":""}。`}</p>
      </div>
      <div className="dl-calendar-icloud-actions"><Link href="/settings#private-calendar">私人 Calendar 設定</Link><button type="button" className="dl-text-btn" disabled={checking} onClick={()=>setRun(count=>count+1)}><RefreshCw size={14} aria-hidden="true"/>更新 iPhone 行程</button></div>
    </section>
    <section className="dl-calendar-board" aria-label="日曆日期">
      <header className="dl-calendar-tools"><button type="button" className="icon-button" onClick={()=>moveMonth(-1)} aria-label="上個月"><ChevronLeft aria-hidden="true"/></button><h2>{Number(month.slice(0,4))} 年 {Number(month.slice(5))} 月</h2><button type="button" className="icon-button" onClick={()=>moveMonth(1)} aria-label="下個月"><ChevronRight aria-hidden="true"/></button><button type="button" className="dl-text-btn" onClick={()=>setCursor(today)}>返今日</button></header>
      <div className="dl-calendar-month">
        <div className="dl-calendar-weekdays" aria-hidden="true">{weekdays.map(w=><span key={w}>星期{w}</span>)}</div>
        <div className="dl-calendar-grid">{dates.map(date=>{
          const rows=agenda.get(date)??[];
          return <button key={date} type="button" data-other={!date.startsWith(month)} aria-label={daylineDate(date,true)+(rows.length?"，"+rows.length+" 項":"")} aria-pressed={date===selected} aria-current={date===today?"date":undefined} onClick={()=>setCursor(date)}><span className="dl-calendar-number">{Number(date.slice(8))}</span><span className="dl-calendar-peek" aria-hidden="true">{rows.slice(0,2).map(row=><span key={row.id} data-kind={row.kind}>{row.title}</span>)}{rows.length>2?<small>另有 {rows.length-2} 項</small>:null}</span></button>;
        })}</div>
      </div>
      <div className="dl-calendar-mobile">
        <div className="dl-calendar-mobile-tools"><button type="button" className="dl-text-btn" onClick={()=>moveWeek(-1)}>← 上星期</button><button type="button" className="dl-text-btn" onClick={()=>moveWeek(1)}>下星期 →</button></div>
        <div className="dl-calendar-week">{weekdays.map((w,index)=>{
          const date=addBriefDays(weekStarts,index),count=agenda.get(date)?.length??0;
          return <button key={w} type="button" aria-pressed={date===selected} aria-current={date===today?"date":undefined} onClick={()=>setCursor(date)} aria-label={daylineDate(date,true)+(count?"，"+count+" 項":"")}><small>星期{w}</small><b>{Number(date.slice(8))}</b>{count?<span className="dl-calendar-dot" aria-hidden="true"/>:null}</button>;
        })}</div>
      </div>
    </section>
    <section className="dl-calendar-selected" aria-labelledby="dayline-calendar-agenda"><div className="dl-section-heading"><div><span className="dl-eyebrow" aria-hidden="true">DAY AGENDA</span><h2 id="dayline-calendar-agenda">{daylineDate(selected,true)}</h2></div></div>
      {selectedRows.length ? <CalendarRows rows={selectedRows}/> : <p className="dl-calendar-empty">{selectedEmpty}</p>}
    </section>
    <details className="dl-calendar-overview"><summary>睇全月安排</summary>{monthEntries.length?monthEntries.map(date=><section key={date} className="dl-calendar-overview-day"><h3>{daylineDate(date,true)}</h3><CalendarRows rows={agenda.get(date)??[]}/></section>):<p className="dl-calendar-empty">本月暫時冇已讀取嘅安排。</p>}</details>
    <p className="dl-calendar-sources">日序只顯示你有權睇嘅資料。iCloud 行程唯讀，要改返 iPhone；Google、Exchange 同只存在手機嘅行程唔會由 iCloud 讀取。</p>
    {adding ? <EventModal initialDate={selected} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} /> : null}
  </div>;
}

function CalendarRows({rows}:{rows:MonthAgendaRow[]}) {
  return <ul className="dl-calendar-events">{rows.map(row=><li key={row.id}>
    <span className="dl-calendar-time">{row.when}</span>
    <div className="dl-calendar-event" data-kind={row.kind}><span className="dl-calendar-kind">{kindLabel[row.kind]}</span>{row.href?<Link href={row.href}>{row.title}</Link>:<strong>{row.title}</strong>}<small>{row.detail}</small></div>
  </li>)}</ul>;
}

function EventModal({ initialDate, onClose, onSaved }: { initialDate: string; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [area, setArea] = useState<"work" | "family" | "personal">("family");
  const [privacy, setPrivacy] = useState("full");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedWithSyncWarning, setSavedWithSyncWarning] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const scheduleStartAt = new Date(`${date}T${startTime}:00+08:00`);
    const scheduleEndAt = new Date(`${date}T${endTime}:00+08:00`);
    if (confirmed && scheduleEndAt <= scheduleStartAt) {
      setMessage("結束時間必須遲過開始時間。");
      return;
    }

    setSaving(true);
    try {
      const result = await controlAction<{
        calendarSync?: { synced: boolean; error?: string } | null;
      }>("create_item", {
        itemType: "event",
        title,
        dueDate: date,
        area,
        sensitive: privacy === "private",
        scheduleStartAt: confirmed ? scheduleStartAt.toISOString() : null,
        scheduleEndAt: confirmed ? scheduleEndAt.toISOString() : null,
        scheduleTimezone: "Asia/Hong_Kong",
        scheduleStatus: confirmed ? "confirmed" : null,
        calendarTarget: confirmed ? area : "none",
        metadata: {
          calendarPrivacy: privacy === "busy" ? "busy" : "full"
        }
      });
      if (confirmed && !result.calendarSync?.synced) {
        setSavedWithSyncWarning(true);
        setMessage(`行程已安全儲存，但 Google Calendar 未同步：${result.calendarSync?.error || "請先到設定連接相應帳戶。"}`);
      } else {
        onSaved();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能儲存日程。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="新增日程" onClose={onClose}>
      <form className="grid gap-4" onSubmit={save}>
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
          <p className="font-bold text-indigo-950">Google Calendar 只收已確認行程</p>
          <p className="mt-1 text-xs leading-5 text-indigo-800">
            普通任務同每日內部計劃會繼續只留喺日序，避免日曆混亂。
          </p>
        </div>

        <label>
          <span className="label">日程名稱</span>
          <input className="field mt-2" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="label">日期</span>
            <input className="field mt-2" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>
          <label>
            <span className="label">範圍</span>
            <select className="field mt-2" value={area} onChange={(event) => setArea(event.target.value as typeof area)}>
              <option value="work">工作 → info@wecarenursing.com.hk</option>
              <option value="family">家庭 → 家庭 Calendar</option>
              <option value="personal">個人 → 已設定個人 Calendar</option>
            </select>
          </label>
        </div>

        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <input className="mt-1 h-5 w-5 accent-indigo-600" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>
            <span className="block font-bold text-slate-900">呢個時間已確認</span>
            <span className="mt-1 block text-xs leading-5 text-slate-600">
              開啟後才會同步到相應 Google Calendar；取消確認會移除已同步事件。
            </span>
          </span>
        </label>

        {confirmed ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="label">開始</span>
              <input className="field mt-2" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
            </label>
            <label>
              <span className="label">結束</span>
              <input className="field mt-2" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required />
            </label>
          </div>
        ) : null}

        <label>
          <span className="label">顯示方式</span>
          <select className="field mt-2" value={privacy} onChange={(event) => setPrivacy(event.target.value)}>
            <option value="private">Google Calendar 隱藏名稱</option>
            <option value="full">按範圍權限顯示完整名稱</option>
            <option value="busy">家庭成員只見「忙碌」</option>
          </select>
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            家庭範圍仍按家庭共享規則處理；呢個設定只控制名稱顯示，唔會把私人／工作 Task 分享出去。
          </span>
        </label>

        {message ? <p className="text-sm font-semibold text-rose-700" role="alert">{message}</p> : null}
        <div className="flex gap-2">
          {savedWithSyncWarning ? (
            <Button type="button" onClick={onSaved}>完成</Button>
          ) : (
            <Button type="submit" disabled={saving}>{saving ? "儲存中…" : confirmed ? "確認並同步" : "儲存為未確認"}</Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        </div>
      </form>
    </Modal>
  );
}
