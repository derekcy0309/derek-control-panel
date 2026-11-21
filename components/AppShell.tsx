"use client";

import { clearNoteDrafts } from "@/lib/notes";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  CalendarDays, CheckSquare2, ChevronDown, CircleUserRound, ClipboardCheck,
  Clock3, Command, HeartHandshake, Home, Inbox, Landmark, Menu, PawPrint, Search,
  Plus, Settings, Share2, ShieldCheck, Sparkles, UsersRound, Pill, Printer, Compass, Newspaper, Route
} from "lucide-react";
import clsx from "clsx";
import { loadControlData } from "@/lib/control-api";
import { clearOfflineWrites } from "@/lib/offline-write-queue";
import { OfflineWriteQueueStatus } from "@/components/OfflineWriteQueueStatus";
import { AssignmentAlerts } from "@/components/AssignmentAlerts";
import { EncouragementFooter } from "@/components/EncouragementFooter";
import { LiveClock } from "@/components/LiveClock";
import { applyAppearance, sectionIdentityForPath } from "@/lib/appearance";
import { useDaylineDate } from "@/hooks/useDaylineDate";
import { daylineWeek } from "@/lib/dayline";
import { DaylineMark } from "@/components/dayline/DaylineMark";
import "@/app/dayline-shared-shell.css";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
type NavTone = "daily" | "planning" | "collaboration" | "family" | "personal" | "system";
type NavGroupData = { label: string; items: NavItem[]; defaultOpen?: boolean; tone: NavTone };

const navGroups: NavGroupData[] = [
  {
    label: "每日使用",
    tone: "daily",
    defaultOpen: true,
    items: [
      { href: "/", label: "今日總覽", icon: Sparkles },
      { href: "/work-guide", label: "開工導航", icon: Compass },
      { href: "/briefing", label: "資訊站／我的網頁", icon: Newspaper },
      { href: "/traffic", label: "交通", icon: Route },
      { href: "/workspace/inbox", label: "收集箱", icon: Inbox }
    ]
  },
  {
    label: "計劃與跟進",
    tone: "planning",
    items: [
      { href: "/workspace/waiting", label: "等待中", icon: Clock3 },
      { href: "/calendar", label: "日曆", icon: CalendarDays },
      { href: "/todo-list", label: "列印 To-do", icon: Printer },
      { href: "/request-duty", label: "Request Duty", icon: ClipboardCheck },
    ]
  },
  {
    label: "協作與檢視",
    tone: "collaboration",
    items: [
      { href: "/sharing", label: "交辦及分享", icon: Share2 },
      { href: "/weekly-review", label: "每週檢視", icon: ClipboardCheck },
      { href: "/body-double", label: "同步專注", icon: UsersRound },
      { href: "/workspace/decision", label: "決策紀錄", icon: Command }
    ]
  },
  {
    label: "家庭",
    tone: "family",
    items: [
      { href: "/workspace/family", label: "家庭總覽", icon: HeartHandshake },
      { href: "/workspace/school", label: "子女及學校", icon: UsersRound },
      { href: "/workspace/pet", label: "寵物", icon: PawPrint },
      { href: "/workspace/household", label: "家居", icon: Home },
      { href: "/workspace/shopping", label: "購物", icon: CheckSquare2 }
    ]
  },
  {
    label: "個人",
    tone: "personal",
    items: [
      { href: "/workspace/personal", label: "個人總覽", icon: CircleUserRound },
      { href: "/workspace/health", label: "健康行政", icon: HeartHandshake },
      { href: "/medications", label: "藥物紀錄", icon: Pill },
      { href: "/workspace/vehicle", label: "車輛", icon: Home },
      { href: "/workspace/note", label: "私人筆記", icon: Inbox },
      { href: "/cashflow", label: "個人財務", icon: Landmark }
    ]
  }
];

const systemItems: NavItem[] = [
  { href: "/search", label: "全域搜尋", icon: Search },
  { href: "/settings", label: "設定", icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState("我的");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showEncouragement, setShowEncouragement] = useState(false);
  const systemGroup: NavGroupData = {
    label: "系統設定",
    tone: "system",
    items: isAdmin ? [...systemItems, { href: "/admin/accounts", label: "帳戶活動", icon: ShieldCheck }] : systemItems
  };

  useEffect(() => {
    let active = true;
    async function loadIdentity() {
      try {
        const data = await loadControlData();
        if (!active) return;
        setDisplayName(data.currentUser.displayName);
        setCurrentUserId(data.currentUser.id);
        setMustChangePassword(Boolean(data.profile.must_change_password));
        setIsAdmin(Boolean(data.profile.is_admin && data.profile.active));
        setShowEncouragement(Boolean(data.showEncouragement));
        if (data.settings) {
        applyAppearance(data.settings.theme, data.settings.visual_intensity);
        document.documentElement.dataset.accent = data.settings.accent_colour || "indigo";
        document.documentElement.dataset.density = data.settings.dashboard_density || "comfortable";
        }
      } catch {
        // Page-level error handling explains missing migrations without leaking details here.
      }
    }
    void loadIdentity();
    return () => { active = false; };
  }, []);

  async function signOut() {
    const response = await fetch("/api/auth", { method: "DELETE", credentials: "same-origin" });
    if(response.ok){try{localStorage.removeItem("dl:device-subscription:markets");localStorage.removeItem("dl:device-subscription:care");}catch{}}
    if (response.ok && currentUserId) {
      await clearOfflineWrites(currentUserId).catch(() => undefined);
      try {
        sessionStorage.removeItem(`dcp:voice-handoff-draft:v1:${currentUserId}`);
        sessionStorage.removeItem(`dcp:task-form-draft:v1:${currentUserId}:new`);
        sessionStorage.removeItem(`dcp:task-form-draft:v1:${currentUserId}:waiting`);
        sessionStorage.removeItem(`dcp:assignment-alerts:v1:${currentUserId}`);
        const guidePrefix=`dcp:guide-next:v1:${currentUserId}:`;
        for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith(guidePrefix))sessionStorage.removeItem(key);}
        clearNoteDrafts(sessionStorage, currentUserId);
        localStorage.removeItem(`dcp:assignment-alerts:v1:${currentUserId}`);
      } catch {
        // Sign-out must still complete if browser storage is unavailable.
      }
    }
    window.location.reload();
  }

  return <DaylineFrame pathname={pathname} name={displayName} userId={currentUserId} system={systemGroup} onSignOut={signOut}
    gates={<>{mustChangePassword?<PasswordChangeGate onComplete={()=>setMustChangePassword(false)}/>:<AssignmentAlerts userId={currentUserId}/>}</>}>
    {children}{showEncouragement ? <EncouragementFooter pathname={pathname} /> : null}
  </DaylineFrame>;
}

function DaylineFrame({pathname,name,userId,system,onSignOut,gates,children}:{pathname:string;name:string;userId:string|null;system:NavGroupData;onSignOut:()=>Promise<void>;gates:React.ReactNode;children:React.ReactNode}){
  const today=useDaylineDate(), [tab,setTab]=useState("focus");
  const menu=useRef<HTMLDetailsElement>(null);
  const landing=pathname==="/";
  const isEditorialPage=landing||pathname==="/calendar"||pathname==="/traffic"||isActive(pathname,"/briefing");
  useEffect(()=>{
    function syncHash(){
      if(window.location.pathname!=="/")return;
      const hash=window.location.hash;
      setTab(hash==="#task-action-list"?"tasks":hash==="#today-order"?"today":"focus");
    }
    const onTab=(e:Event)=>setTab((e as CustomEvent<string>).detail);
    window.addEventListener("dayline:tab",onTab);
    window.addEventListener("hashchange",syncHash);
    syncHash();
    return()=>{window.removeEventListener("dayline:tab",onTab);window.removeEventListener("hashchange",syncHash);};
  },[]);
  useEffect(()=>{
    if(menu.current)menu.current.open=false;
  },[pathname]);
  useEffect(()=>{
    const closeOutside=(event:PointerEvent)=>{
      const target=event.target, popup=menu.current;
      if(popup?.open&&target instanceof Node&&!popup.contains(target))popup.open=false;
    };
    document.addEventListener("pointerdown",closeOutside,{passive:true});
    return()=>document.removeEventListener("pointerdown",closeOutside);
  },[]);
  function changeHome(view:"overview"|"tasks"){
    if(menu.current)menu.current.open=false;
    if(!landing)return;
    setTab(view==="tasks"?"tasks":"focus");
    window.dispatchEvent(new Event("dayline:"+view));
  }
  return <div className="dl-viewport"><div className="app-frame dl-shell dl-unified-chrome" data-palette={daylineWeek(today)} data-section={sectionIdentityForPath(pathname)}>
    {gates}
    <header className="dl-mast dl-mast--studio no-print"><div className="dl-mastin">
      <Link href="/" className="dl-brand" aria-label="日序 Dayline · 今日總覽" onClick={()=>changeHome("overview")}><DaylineMark/><b>日序</b><em>Dayline</em></Link>
      <nav className="dl-nav" aria-label="主要導覽">
        <Link href="/" aria-current={landing&&tab!=="tasks"?"page":undefined} onClick={()=>changeHome("overview")}>今日總覽</Link>
        <Link href="/#task-action-list" aria-current={(landing&&tab==="tasks")||isActive(pathname,"/tasks")?"page":undefined} onClick={()=>changeHome("tasks")}>我的任務</Link>
        <Link href="/calendar" aria-current={pathname==="/calendar"?"page":undefined}>日曆</Link>
        <Link href="/briefing" aria-current={isActive(pathname,"/briefing")?"page":undefined}>資訊站</Link>
        <Link href="/traffic" prefetch={false} aria-current={pathname==="/traffic"?"page":undefined}>交通</Link>
      </nav>
      <div className="dl-account"><span className="dl-who">{name}</span><span className="dl-avatar" aria-hidden="true">{Array.from(name)[0]?.toUpperCase()}</span></div>
      <details className="dl-all-nav" ref={menu} onKeyDown={e=>{if(e.key==="Escape"&&e.currentTarget.open){e.preventDefault();e.stopPropagation();e.currentTarget.open=false;e.currentTarget.querySelector("summary")?.focus();}}}><summary aria-label="更多功能" aria-controls="dayline-more"><Menu aria-hidden="true"/></summary>
        <div className="dl-sheet-nav" id="dayline-more" onClick={e=>{if(e.target instanceof Element&&e.target.closest("a")&&menu.current)menu.current.open=false;}}><h2>更多功能</h2><div className="dl-toolrow">{landing?null:<Link href="/?newTask=1" prefetch={false}><Plus aria-hidden="true"/>加 Task</Link>}<Link href="/capture">快速收集</Link><Link href="/search">搜尋</Link><Link href="/#task-action-list" onClick={()=>changeHome("tasks")}>我的任務</Link></div>
          {[...navGroups,system].map(group=><NavGroup key={group.label} group={group} pathname={pathname} onOverview={()=>changeHome("overview")}/>)}
          <LiveClock/><button type="button" className="min-h-11 underline" onClick={()=>void onSignOut()}>登出</button>
        </div></details>
    </div></header>
    <main className={clsx("dl-page",!isEditorialPage&&"dl-inner-page")} id="main-content"><OfflineWriteQueueStatus userId={userId}/>{children}</main>
  </div></div>;
}

function PasswordChangeGate({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    if (password.length < 8) { setMessage("新密碼最少需要 8 個字元。"); return; }
    if (password !== confirmPassword) { setMessage("兩次輸入的密碼不一致。"); return; }
    setSaving(true);
    const response = await fetch("/api/auth", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ action: "change_password", password })
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setSaving(false);
    if (!response.ok) { setMessage(result.error || "未能更新密碼。"); return; }
    setPassword(""); setConfirmPassword(""); onComplete();
  }
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="password-change-title"><form className="panel w-full max-w-md p-6 sm:p-8" onSubmit={submit}><p className="eyebrow">首次登入安全設定</p><h2 id="password-change-title" className="mt-1 text-2xl font-bold">請立即設定你的新密碼</h2><p className="muted mt-3 text-sm leading-6">臨時密碼只供首次登入。完成更新前，系統會保持此畫面。</p><label className="mt-5 block"><span className="label">新密碼</span><input className="field mt-2" type="password" minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label className="mt-4 block"><span className="label">再次輸入新密碼</span><input className="field mt-2" type="password" minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label><button className="mt-5 min-h-11 w-full rounded-xl bg-indigo-600 px-4 font-bold text-white disabled:opacity-60" type="submit" disabled={saving}>{saving ? "更新中…" : "更新密碼並繼續"}</button>{message ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{message}</p> : null}</form></div>;
}

function NavGroup({ group, pathname, onOverview }: { group: NavGroupData; pathname: string; onOverview: () => void }) {
  const activeGroup = group.items.some((item) => isActive(pathname, item.href));
  const [open, setOpen] = useState(Boolean(group.defaultOpen || activeGroup));

  useEffect(() => {
    setOpen(Boolean(group.defaultOpen || activeGroup));
  }, [activeGroup, group.defaultOpen]);

  return (
    <section className={clsx("mb-4", `nav-group-${group.tone}`)}>
      <button type="button" className="nav-group-title" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>{group.label}</span><ChevronDown className={clsx("h-4 w-4 transition", !open && "-rotate-90")} />
      </button>
      {open ? <div className="grid grid-cols-2 gap-1">{group.items.map((item) => <NavLink key={`${item.href}-${item.label}`} item={item} active={isActive(pathname, item.href)} onClick={item.href==="/"?onOverview:undefined} />)}</div> : null}
    </section>
  );
}

function NavLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: () => void }) {
  const Icon = item.icon;
  return <Link href={item.href} prefetch={false} onClick={onClick} aria-current={active?"page":undefined} className={clsx("sidebar-link", active && "is-active")}><Icon className="h-[1.1rem] w-[1.1rem]" aria-hidden="true"/><span>{item.label}</span></Link>;
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
