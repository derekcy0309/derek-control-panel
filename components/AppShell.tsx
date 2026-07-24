"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Archive, BriefcaseBusiness, CalendarDays, CheckSquare2, ChevronDown, CircleUserRound, ClipboardCheck,
  Clock3, Command, HeartHandshake, Home, Inbox, Landmark, Menu, PawPrint, Search,
  PlusCircle, Settings, Share2, Sparkles, UsersRound, X
} from "lucide-react";
import clsx from "clsx";
import { loadControlData } from "@/lib/control-api";

const navGroups = [
  {
    label: "主要",
    items: [
      { href: "/", label: "今日", icon: Sparkles },
      { href: "/workspace/inbox", label: "收集箱", icon: Inbox },
      { href: "/calendar", label: "日曆", icon: CalendarDays },
      { href: "/tasks", label: "任務", icon: CheckSquare2 },
      { href: "/deadlines", label: "死線", icon: Clock3 }
    ]
  },
  {
    label: "工作",
    items: [
      { href: "/workspace/project", label: "項目作戰室", icon: BriefcaseBusiness },
      { href: "/workspace/waiting", label: "等待中", icon: Clock3 },
      { href: "/body-double", label: "同步專注", icon: UsersRound },
      { href: "/weekly-review", label: "每週檢視", icon: ClipboardCheck },
      { href: "/sharing", label: "交辦中心", icon: Share2 },
      { href: "/workspace/decision", label: "決策紀錄", icon: Command },
      { href: "/workspace/client", label: "客戶流程", icon: UsersRound },
      { href: "/workspace/sop", label: "SOP", icon: Archive },
      { href: "/cashflow", label: "財務", icon: Landmark }
    ]
  },
  {
    label: "家庭",
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
    items: [
      { href: "/workspace/personal", label: "個人總覽", icon: CircleUserRound },
      { href: "/workspace/health", label: "健康行政", icon: HeartHandshake },
      { href: "/workspace/document", label: "文件", icon: Archive },
      { href: "/workspace/vehicle", label: "車輛", icon: Home },
      { href: "/workspace/note", label: "私人筆記", icon: Inbox }
    ]
  },
  {
    label: "分享及系統",
    items: [
      { href: "/sharing", label: "分享中心", icon: Share2 },
      { href: "/search", label: "全域搜尋", icon: Search },
      { href: "/settings", label: "設定", icon: Settings }
    ]
  }
] as const;

const mobileNav = [
  { href: "/", label: "今日", icon: Sparkles },
  { href: "/workspace/inbox", label: "收集箱", icon: Inbox },
  { href: "/calendar", label: "日曆", icon: CalendarDays },
  { href: "/tasks", label: "任務", icon: CheckSquare2 }
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState("我的");
  const [moreOpen, setMoreOpen] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadIdentity() {
      try {
        const data = await loadControlData();
        if (!active) return;
        setDisplayName(data.currentUser.displayName);
        setMustChangePassword(Boolean(data.profile.must_change_password));
        if (data.settings) {
        const theme = data.settings.theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : data.settings.theme;
        document.documentElement.dataset.theme = theme || "light";
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

  useEffect(() => { setMoreOpen(false); }, [pathname]);

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE", credentials: "same-origin" });
    window.location.reload();
  }

  return (
    <div className="app-frame min-h-screen bg-mist text-ink">
      {mustChangePassword ? <PasswordChangeGate onComplete={() => setMustChangePassword(false)} /> : null}
      <aside className="sidebar hidden lg:flex" aria-label="主要導覽">
        <Brand displayName={displayName} />
        <div className="sidebar-scroll">
          {navGroups.map((group) => <NavGroup key={group.label} group={group} pathname={pathname} />)}
        </div>
        <button className="sidebar-signout" onClick={signOut}>登出</button>
      </aside>

      <div className="min-w-0 lg:pl-[17.5rem]">
        <header className="topbar">
          <Brand displayName={displayName} compact />
          <div className="flex items-center gap-2">
            <Link className="icon-button" href="/capture" aria-label="快速收集"><PlusCircle className="h-5 w-5" /></Link>
            <Link className="icon-button" href="/search" aria-label="搜尋"><Search className="h-5 w-5" /></Link>
            <button className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 sm:block lg:hidden" onClick={signOut}>登出</button>
          </div>
        </header>
        <main id="main-content" className="mx-auto w-full max-w-[90rem] px-4 pb-28 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pb-10">{children}</main>
      </div>

      <nav className="mobile-nav lg:hidden" aria-label="手機導覽">
        {mobileNav.map((item) => <MobileLink key={item.href} item={item} active={isActive(pathname, item.href)} />)}
        <button className={clsx("mobile-nav-item", moreOpen && "is-active")} onClick={() => setMoreOpen(true)} aria-label="更多功能">
          <Menu className="h-5 w-5" /><span>更多</span>
        </button>
      </nav>

      {moreOpen ? (
        <div className="sheet-backdrop lg:hidden" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setMoreOpen(false)}>
          <section className="mobile-sheet" role="dialog" aria-modal="true" aria-label="更多功能">
            <div className="sheet-handle" />
            <div className="flex items-center justify-between px-5 pb-3">
              <div><p className="eyebrow">{displayName} Panel</p><h2 className="text-xl font-bold">更多功能</h2></div>
              <button className="icon-button" onClick={() => setMoreOpen(false)} aria-label="關閉"><X className="h-5 w-5" /></button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {navGroups.slice(1).map((group) => <NavGroup key={group.label} group={group} pathname={pathname} mobile />)}
              <button className="mt-3 min-h-11 w-full rounded-xl px-3 text-left font-semibold text-slate-600 hover:bg-slate-100" onClick={signOut}>登出</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
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

function Brand({ displayName, compact = false }: { displayName: string; compact?: boolean }) {
  return (
    <div className={compact ? "flex min-w-0 items-center gap-3 lg:hidden" : "brand-block"}>
      <div className="brand-mark">D</div>
      <div className="min-w-0">
        {!compact ? <p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-indigo-500">Control Panel</p> : null}
        <p className={clsx("truncate font-bold tracking-tight", compact ? "text-lg" : "mt-0.5 text-xl")}>{displayName} Panel</p>
      </div>
    </div>
  );
}

function NavGroup({ group, pathname, mobile = false }: { group: (typeof navGroups)[number]; pathname: string; mobile?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={mobile ? "mb-4" : "nav-group"}>
      <button className="nav-group-title" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>{group.label}</span><ChevronDown className={clsx("h-4 w-4 transition", !open && "-rotate-90")} />
      </button>
      {open ? <div className={mobile ? "grid grid-cols-2 gap-1" : "space-y-0.5"}>{group.items.map((item) => <NavLink key={`${item.href}-${item.label}`} item={item} active={isActive(pathname, item.href)} />)}</div> : null}
    </section>
  );
}

function NavLink({ item, active }: { item: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }; active: boolean }) {
  const Icon = item.icon;
  return <Link href={item.href} className={clsx("sidebar-link", active && "is-active")}><Icon className="h-[1.1rem] w-[1.1rem]" /><span>{item.label}</span></Link>;
}

function MobileLink({ item, active }: { item: (typeof mobileNav)[number]; active: boolean }) {
  const Icon = item.icon;
  return <Link href={item.href} className={clsx("mobile-nav-item", active && "is-active")}><Icon className="h-5 w-5" /><span>{item.label}</span></Link>;
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
