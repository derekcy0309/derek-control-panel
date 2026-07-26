"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, CalendarX2, Check, Clock3, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type {
  AIDailyPlan,
  CapacityCheckin,
  EnergyLevel,
  LoadLevel,
  Task,
  UserSettings,
  WorkWindow
} from "@/lib/types";

type WorkWindowRow = WorkWindow & { id: string };

export function AIDailyPlanner({
  date,
  capacity,
  settings,
  tasks,
  onAccepted
}: {
  date: string;
  capacity: CapacityCheckin | null;
  settings: UserSettings;
  tasks: Task[];
  onAccepted: () => Promise<void>;
}) {
  const initialWindows: WorkWindow[] = capacity?.work_windows?.length
    ? capacity.work_windows
    : [{ start: "09:30", end: "12:00" }];
  const nextWindowId = useRef(initialWindows.length);
  const [windows, setWindows] = useState<WorkWindowRow[]>(() =>
    initialWindows.map((window, index) => ({ ...window, id: `initial-${index}` }))
  );
  const [energy, setEnergy] = useState<EnergyLevel>(capacity?.energy_level ?? "medium");
  const [mode, setMode] = useState<CapacityCheckin["mode"]>(capacity?.mode ?? "normal");
  const [familyLoad, setFamilyLoad] = useState<LoadLevel>(capacity?.family_load ?? settings.default_family_load ?? "medium");
  const [recoveryNeed, setRecoveryNeed] = useState<LoadLevel>(capacity?.recovery_need ?? "medium");
  const [bufferMinutes, setBufferMinutes] = useState(
    capacity?.buffer_minutes
      ?? nearestBufferMinutes(totalWindowMinutes(initialWindows) * (settings.planning_buffer_percent ?? 20) / 100)
  );
  const [plan, setPlan] = useState<AIDailyPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`/api/ai/plan-day?date=${encodeURIComponent(date)}`, {
      credentials: "same-origin",
      cache: "no-store"
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as { plan?: AIDailyPlan | null };
      if (active && response.ok && body.plan) setPlan(body.plan);
    });
    return () => { active = false; };
  }, [date]);

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const workableMinutes = useMemo(() => windows.reduce((total, window) => {
    const [startHour, startMinute] = window.start.split(":").map(Number);
    const [endHour, endMinute] = window.end.split(":").map(Number);
    return total + Math.max(0, endHour * 60 + endMinute - startHour * 60 - startMinute);
  }, 0), [windows]);

  function updateWindow(index: number, field: keyof WorkWindow, value: string) {
    setWindows((current) => current.map((window, itemIndex) =>
      itemIndex === index ? { ...window, [field]: value } : window
    ));
  }

  async function generate() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/ai/plan-day", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          workWindows: windows.map(({ start, end }) => ({ start, end })),
          energyLevel: energy,
          mode,
          familyLoad,
          recoveryNeed,
          bufferMinutes,
          preference: settings.support_profile === "adhd" || energy === "low" ? "easier" : "balanced"
        })
      });
      const body = await response.json().catch(() => ({})) as { plan?: AIDailyPlan; error?: string };
      if (!response.ok || !body.plan) throw new Error(body.error || "未能產生今日工作計劃。");
      setPlan(body.plan);
      setMessage(body.plan.source === "rules_fallback"
        ? "已用免費安全規則引擎完成安排，不會產生 AI API 費用。"
        : "已產生內部工作計劃；仍然未寫入 Google Calendar。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能產生今日工作計劃。");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!plan) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/ai/plan-day", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id })
      });
      const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error || "未能接受計劃。");
      setPlan((current) => current ? {
        ...current,
        status: "accepted",
        accepted_at: new Date().toISOString()
      } : current);
      setMessage(body.message || "已加入今日安排。");
      await onAccepted();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能接受計劃。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ai-planner-card overflow-hidden rounded-[1.4rem] border p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="eyebrow flex items-center gap-2"><Brain className="h-4 w-4" />智能每日排程</p>
          <h2 className="section-title mt-1">輸入真正可工作時間，系統幫你收窄今日</h2>
          <p className="muted mt-2 text-sm leading-6">
            系統會按安全、期限、WIP、能量同容量自動安排；保留家庭緩衝、休息同恢復空間，全程不使用付費 AI。
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white/75 px-3 py-2 text-xs font-bold text-slate-600">
          <CalendarX2 className="h-4 w-4 text-indigo-600" />
          內部計劃不會同步 Google Calendar
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_.72fr]">
        <div className="rounded-2xl border border-white/80 bg-white/80 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="label">今日可工作時段</p>
              <p className="mt-1 text-xs text-slate-500">可以輸入幾段，中間照顧小朋友、動物或休息。</p>
            </div>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">
              約 {Math.floor(workableMinutes / 60)} 小時 {workableMinutes % 60} 分
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {windows.map((window, index) => (
              <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2" key={window.id}>
                <input className="field" type="time" value={window.start} onChange={(event) => updateWindow(index, "start", event.target.value)} aria-label={`工作時段 ${index + 1} 開始`} />
                <span className="text-sm font-bold text-slate-400">至</span>
                <input className="field" type="time" value={window.end} onChange={(event) => updateWindow(index, "end", event.target.value)} aria-label={`工作時段 ${index + 1} 結束`} />
                <button className="icon-button" type="button" disabled={windows.length === 1} onClick={() => setWindows((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="移除時段">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <Button className="mt-3" type="button" variant="ghost" disabled={windows.length >= 8} onClick={() => setWindows((current) => [
            ...current,
            { id: `added-${nextWindowId.current++}`, start: "14:00", end: "16:00" }
          ])}>
            <Plus className="h-4 w-4" />加入另一段時間
          </Button>
        </div>

        <div className="grid gap-3 rounded-2xl border border-white/80 bg-white/80 p-4 sm:grid-cols-2 xl:grid-cols-1">
          <label><span className="label">今日能量</span><select className="field mt-2" value={energy} onChange={(event) => setEnergy(event.target.value as EnergyLevel)}><option value="low">低 — 先做小步</option><option value="medium">中</option><option value="high">高</option></select></label>
          <label><span className="label">今日模式</span><select className="field mt-2" value={mode} onChange={(event) => setMode(event.target.value as CapacityCheckin["mode"])}><option value="normal">正常</option><option value="gentle">溫和</option><option value="minimum_step">最低可行日</option><option value="shift">夜更／輪班</option></select></label>
          <label><span className="label">家庭負擔</span><select className="field mt-2" value={familyLoad} onChange={(event) => setFamilyLoad(event.target.value as LoadLevel)}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
          <label><span className="label">今日恢復需要</span><select className="field mt-2" value={recoveryNeed} onChange={(event) => setRecoveryNeed(event.target.value as LoadLevel)}><option value="low">低</option><option value="medium">中</option><option value="high">高 — 自動減量</option></select></label>
          <label><span className="label">預留突發／恢復</span><select className="field mt-2" value={bufferMinutes} onChange={(event) => setBufferMinutes(Number(event.target.value))}><option value={15}>15 分鐘</option><option value={30}>30 分鐘</option><option value={60}>60 分鐘</option><option value={90}>90 分鐘</option></select></label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" disabled={busy || !windows.length} onClick={() => void generate()}>
          <Sparkles className="h-5 w-5" />{busy ? "安排中…" : plan ? "重新安排今日" : "自動安排今日工作"}
        </Button>
        <p className="text-xs leading-5 text-slate-500">
          {settings.support_profile === "adhd"
            ? "ADHD 配合：減少轉題、先推進已開始工作、每步可立即做。"
            : settings.support_profile === "depression"
              ? "溫和配合：減少任務數量、避免責備、低能量時只保留最低一步。"
              : "平衡模式：按期限、風險、能量同容量安排。"}
        </p>
      </div>

      {plan ? (
        <div className="mt-5 rounded-2xl border border-indigo-100 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">{plan.status === "accepted" ? "已接受的內部計劃" : "內部計劃預覽"}</p>
              <p className="mt-1 font-bold text-slate-900">{plan.summary}</p>
            </div>
            {plan.status === "accepted" ? <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800"><Check className="h-3.5 w-3.5" />已接受</span> : null}
          </div>
          <div className="mt-4 space-y-2">
            {plan.items.map((item) => {
              const task = taskById.get(item.task_id);
              return (
                <article className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:grid-cols-[7rem_1fr]" key={item.id}>
                  <p className="flex items-center gap-2 text-sm font-extrabold text-indigo-700"><Clock3 className="h-4 w-4" />{formatTime(item.starts_at)}–{formatTime(item.ends_at)}</p>
                  <div>
                    <p className="font-bold text-slate-900">{task?.title ?? "你可執行嘅任務"}</p>
                    <p className="mt-1 text-sm text-slate-600">先做：{item.first_step}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{item.reason}{item.effort_tip ? ` · ${item.effort_tip}` : ""}</p>
                  </div>
                </article>
              );
            })}
          </div>
          {plan.status === "draft" ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button type="button" variant="success" disabled={busy} onClick={() => void accept()}>
                <Check className="h-5 w-5" />接受內部計劃
              </Button>
              <p className="text-xs text-slate-500">接受後會沿用現有 Today 確認流程；唔會建立 Calendar event。</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {message ? <p className="mt-4 rounded-xl bg-white/80 p-3 text-sm font-semibold text-slate-700" role="status">{message}</p> : null}
    </section>
  );
}

function totalWindowMinutes(windows: WorkWindow[]) {
  return windows.reduce((total, window) => {
    const [startHour, startMinute] = window.start.split(":").map(Number);
    const [endHour, endMinute] = window.end.split(":").map(Number);
    return total + Math.max(0, endHour * 60 + endMinute - startHour * 60 - startMinute);
  }, 0);
}

function nearestBufferMinutes(value: number) {
  return [15, 30, 60, 90].reduce(
    (nearest, option) => Math.abs(option - value) < Math.abs(nearest - value) ? option : nearest,
    30
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}
