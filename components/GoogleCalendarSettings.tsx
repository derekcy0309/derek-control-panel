"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Link2, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { GoogleCalendarConnection } from "@/lib/types";

type Target = "personal" | "family" | "work";
type CalendarOption = { id: string; summary: string; primary?: boolean };

const targetConfig: Array<{ target: Target; title: string; description: string }> = [
  { target: "personal", title: "個人 Calendar", description: "私人已確認行程；只可使用畫面顯示的指定 Google 帳戶。" },
  { target: "family", title: "家庭 Calendar", description: "家庭已確認行程；只可使用指定帳戶內有寫入權限的共享家庭 Calendar。" },
  { target: "work", title: "工作 Calendar", description: "工作已確認行程；固定使用 info@wecarenursing.com.hk。" }
];

export function GoogleCalendarSettings({
  initialConnections
}: {
  initialConnections: GoogleCalendarConnection[];
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [expectedAccounts, setExpectedAccounts] = useState<Record<Target, string>>({
    personal: "",
    family: "",
    work: "info@wecarenursing.com.hk"
  });
  const [calendars, setCalendars] = useState<Partial<Record<Target, CalendarOption[]>>>({});
  const [busyTarget, setBusyTarget] = useState<Target | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => { setConnections(initialConnections); }, [initialConnections]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("calendar");
    if (!result) return;
    if (result === "connected") {
      setMessage("Google Calendar 已連接；請確認下面選中嘅目標 Calendar。");
    } else if (result === "wrong_account") {
      setMessage(`Google 帳戶不正確。呢個連接需要使用 ${params.get("expected") || "指定帳戶"}。`);
    } else if (result === "invalid_state") {
      setMessage("Google 授權驗證已失效，請重新連接。");
    } else {
      setMessage(`Google Calendar 未能連接：${params.get("reason") || "請檢查授權設定。"}`);
    }
    const cleanUrl = new URL(window.location.href);
    ["calendar", "target", "expected", "reason"].forEach((key) => cleanUrl.searchParams.delete(key));
    window.history.replaceState({}, "", cleanUrl);
  }, []);
  useEffect(() => {
    let active = true;
    void fetch("/api/integrations/google-calendar", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as {
          expectedAccounts?: Record<Target, string>;
          connections?: GoogleCalendarConnection[];
        };
        if (!active || !response.ok) return;
        if (body.expectedAccounts) setExpectedAccounts(body.expectedAccounts);
        if (body.connections) setConnections(body.connections);
      });
    return () => { active = false; };
  }, []);

  async function loadCalendars(target: Target) {
    setBusyTarget(target);
    setMessage("");
    try {
      const response = await fetch(`/api/integrations/google-calendar?calendars=${target}`, {
        credentials: "same-origin",
        cache: "no-store"
      });
      const body = await response.json().catch(() => ({})) as { calendars?: CalendarOption[]; error?: string };
      if (!response.ok) throw new Error(body.error || "未能讀取 Calendar。");
      setCalendars((current) => ({ ...current, [target]: body.calendars ?? [] }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能讀取 Calendar。");
    } finally {
      setBusyTarget(null);
    }
  }

  async function action(target: Target, actionName: "select_calendar" | "disconnect", extra: Record<string, unknown> = {}) {
    setBusyTarget(target);
    setMessage("");
    try {
      const response = await fetch("/api/integrations/google-calendar", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionName, target, ...extra })
      });
      const body = await response.json().catch(() => ({})) as {
        connection?: GoogleCalendarConnection;
        disconnected?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "未能更新 Calendar。");
      if (body.disconnected) setConnections((current) => current.filter((item) => item.target !== target));
      if (body.connection) setConnections((current) => [...current.filter((item) => item.target !== target), body.connection!]);
      setMessage(actionName === "disconnect" ? "已解除連接。" : "已更新目標 Calendar。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能更新 Calendar。");
    } finally {
      setBusyTarget(null);
    }
  }

  return (
    <section className="panel p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow flex items-center gap-2"><CalendarCheck className="h-4 w-4" />Google Calendar</p>
          <h2 className="section-title mt-1">只同步已確認行程</h2>
          <p className="muted mt-2 max-w-2xl text-sm leading-6">
            普通 Task、內部每日計劃、Focus block 同暫定行程全部留喺系統；只係 Confirmed Schedule 先會同步。
          </p>
        </div>
        <span className="flex w-fit items-center gap-2 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">
          <ShieldCheck className="h-4 w-4" />OAuth token 加密
        </span>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {targetConfig.map((config) => {
          const connection = connections.find((item) => item.target === config.target);
          const options = calendars[config.target];
          return (
            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4" key={config.target}>
              <div className="flex items-start justify-between gap-2">
                <div><h3 className="font-extrabold text-slate-900">{config.title}</h3><p className="mt-1 text-xs leading-5 text-slate-600">{config.description}</p></div>
                <span className={`h-2.5 w-2.5 rounded-full ${connection?.status === "connected" ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden="true" />
              </div>
              <p className="mt-3 truncate text-xs font-semibold text-slate-500">指定帳戶：{connection?.account_email || expectedAccounts[config.target] || "登入電郵"}</p>
              {connection ? (
                <>
                  <p className="mt-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-800">{connection.calendar_name}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" disabled={busyTarget === config.target} onClick={() => void loadCalendars(config.target)}><RefreshCw className="h-4 w-4" />選擇 Calendar</Button>
                    <Button type="button" variant="ghost" disabled={busyTarget === config.target} onClick={() => void action(config.target, "disconnect")}><Unplug className="h-4 w-4" />解除</Button>
                  </div>
                  {options?.length ? (
                    <select className="field mt-3 bg-white" value={connection.calendar_id} onChange={(event) => {
                      const selected = options.find((item) => item.id === event.target.value);
                      if (selected) void action(config.target, "select_calendar", { calendarId: selected.id, calendarName: selected.summary });
                    }}>
                      {options.map((option) => <option key={option.id} value={option.id}>{option.summary}{option.primary ? "（主要）" : ""}</option>)}
                    </select>
                  ) : null}
                </>
              ) : (
                <a className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white" href={`/api/integrations/google-calendar/connect?target=${config.target}`}>
                  <Link2 className="h-4 w-4" />連接 Google
                </a>
              )}
            </article>
          );
        })}
      </div>
      {message ? <p className="mt-3 text-sm font-semibold text-slate-700" role="status">{message}</p> : null}
    </section>
  );
}
