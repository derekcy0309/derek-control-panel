"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Link2, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { GoogleCalendarConnection } from "@/lib/types";

type Target = "personal" | "family" | "work";
type CalendarOption = { id: string; summary: string; primary?: boolean };
type SettingsConnection = GoogleCalendarConnection & { show_work_in_agenda?: boolean };

const targetConfig: Array<{ target: Target; title: string; description: string }> = [
  { target: "personal", title: "個人 Calendar", description: "個人已確認行程；連接時自行選擇 Google 帳戶及有寫入權限的 Calendar。" },
  { target: "family", title: "家庭 Calendar", description: "家庭已確認行程；可選任何你有寫入權限的 Google 帳戶與共享 Calendar。" },
  { target: "work", title: "工作 Calendar", description: "工作已確認行程；預設建議 info@wecarenursing.com.hk，亦可自行改選其他帳戶。" }
];

export function GoogleCalendarSettings({
  initialConnections
}: {
  initialConnections: GoogleCalendarConnection[];
}) {
  const [loadedConnections, setLoadedConnections] = useState<SettingsConnection[] | null>(null);
  const connections: SettingsConnection[] = loadedConnections ?? initialConnections;
  const [accountHints, setAccountHints] = useState<Record<Target, string>>({
    personal: "",
    family: "",
    work: "info@wecarenursing.com.hk"
  });
  const [calendars, setCalendars] = useState<Partial<Record<Target, CalendarOption[]>>>({});
  const [busyTarget, setBusyTarget] = useState<Target | null>(null);
  const [settingsReadFailed, setSettingsReadFailed] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("calendar");
    if (!result) return;
    if (result === "connected") {
      setMessage("Google Calendar 已連接；請確認下面選中嘅目標 Calendar。");
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
          accountHints?: Record<Target, string>;
          connections?: SettingsConnection[];
        };
        if (!active) return;
        if (!response.ok || !body.connections) {
          setSettingsReadFailed(true);
          return;
        }
        if (body.accountHints) setAccountHints(body.accountHints);
        setLoadedConnections(body.connections);
      }).catch(() => { if (active) setSettingsReadFailed(true); });
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

  async function action(target: Target, actionName: "select_calendar" | "disconnect" | "set_work_agenda", extra: Record<string, unknown> = {}) {
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
        connection?: SettingsConnection;
        disconnected?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "未能更新 Calendar。");
      const updatedConnection = body.connection;
      if (body.disconnected || updatedConnection) {
        setLoadedConnections((current) => [
          ...(current ?? initialConnections).filter((item) => item.target !== target),
          ...(updatedConnection ? [updatedConnection] : [])
        ]);
      }
      if (actionName === "set_work_agenda") {
        if (typeof updatedConnection?.show_work_in_agenda !== "boolean") throw new Error("未能確認是否已儲存。請重新載入設定。");
        setMessage(updatedConnection.show_work_in_agenda ? "已開啟。工作行程會在你的「行程及限期」顯示。" : "已關閉工作行程顯示。");
      } else if (actionName === "disconnect") {
        setMessage("已解除連接。");
      } else {
        setMessage(target === "work" && updatedConnection?.calendar_id !== connections.find((item) => item.target === target)?.calendar_id
          ? "已更新目標 Calendar。要顯示新 Calendar 嘅行程，請重新開啟下方設定。"
          : "已更新目標 Calendar。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能更新 Calendar。");
    } finally {
      setBusyTarget(null);
    }
  }

  return (
    <section id="google-calendar" className="panel scroll-mt-24 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow flex items-center gap-2"><CalendarCheck className="h-4 w-4" />Google Calendar</p>
          <h2 className="section-title mt-1">只同步已確認行程</h2>
          <p className="muted mt-2 max-w-2xl text-sm leading-6">
            只有日序入面已確認嘅行程會寫入 Google Calendar。工作 Calendar 亦可以另外開啟唯讀顯示。
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
              <p className="mt-3 break-words text-xs font-semibold text-slate-500">{connection ? `已連接帳戶：${connection.account_email}` : `連接提示：${accountHints[config.target] || "自行選擇"}`}</p>
              {connection ? (
                <>
                  <p className="mt-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-800">{connection.calendar_name}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" disabled={busyTarget === config.target} onClick={() => void loadCalendars(config.target)}><RefreshCw className="h-4 w-4" />選擇 Calendar</Button>
                    <a className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700" href={`/api/integrations/google-calendar/connect?target=${config.target}`}><Link2 className="h-4 w-4" />更換帳戶</a>
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
                  <Link2 className="h-4 w-4" />連接並選擇帳戶
                </a>
              )}
              {config.target === "work" ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-800">
                    <input type="checkbox" role="switch" className="h-5 w-5 shrink-0 accent-indigo-600"
                      aria-describedby="work-google-agenda-help"
                      checked={connection?.show_work_in_agenda === true}
                      disabled={!connection || typeof connection.show_work_in_agenda !== "boolean" || busyTarget !== null
                        || (!connection.show_work_in_agenda && connection.status !== "connected")}
                      onChange={(event) => {
                        if (connection) void action("work", "set_work_agenda", {
                          enabled: event.currentTarget.checked,
                          calendarId: connection.calendar_id,
                          accountEmail: connection.account_email
                        });
                      }}
                    />
                    在「行程及限期」顯示工作日曆
                  </label>
                  <p id="work-google-agenda-help" className="pb-1 text-xs leading-5 text-slate-600">
                    {!connection
                      ? "先連接工作 Google 帳戶，再開啟唯讀顯示。"
                      : typeof connection.show_work_in_agenda !== "boolean"
                        ? settingsReadFailed ? "未能讀取顯示設定。請重新載入此頁。" : "讀取顯示設定中…"
                        : !connection.show_work_in_agenda && connection.status !== "connected"
                          ? "請先重新連接工作 Calendar。"
                          : "只喺你自己嘅日序帳戶顯示。要改外部行程，請去 Google Calendar。"}
                  </p>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {message ? <p className="mt-3 text-sm font-semibold text-slate-700" role="status">{message}</p> : null}
    </section>
  );
}
