"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarDays, CheckSquare, Home, Landmark, Settings } from "lucide-react";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";

const navItems = [
  { href: "/", label: "控制面板", icon: Home },
  { href: "/tasks", label: "任務", icon: CheckSquare },
  { href: "/cashflow", label: "現金流", icon: Landmark },
  { href: "/meetings", label: "會議", icon: CalendarDays },
  { href: "/settings", label: "設定", icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  async function signOut() {
    await supabase?.auth.signOut();
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-mist">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <p className="text-xs font-semibold text-indigo-600">私人控制台</p>
            <h1 className="text-xl font-bold text-ink sm:text-2xl">Derek 控制面板</h1>
          </div>
          <button
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            onClick={signOut}
          >
            登出
          </button>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 pb-3 sm:px-6">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-base font-semibold transition",
                  active ? "bg-indigo-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
