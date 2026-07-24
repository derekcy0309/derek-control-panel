"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Clock3, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import type { NotificationDelivery, NotificationPreferences } from "@/lib/types";

type NotificationSettingsProps = {
  preferences: NotificationPreferences | null;
  deliveries: NotificationDelivery[];
  activeSubscriptionCount: number;
  timezone: string;
  onChanged: () => Promise<void>;
};

type PreferencesForm = {
  browserEnabled: boolean;
  todayFirstEnabled: boolean;
  deadlineEnabled: boolean;
  waitingEnabled: boolean;
  handoverEnabled: boolean;
  focusEnabled: boolean;
  shutdownEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  nightShiftMode: boolean;
  timezone: string;
  todayReminderTime: string;
  shutdownReminderTime: string;
  deadlineLeadMinutes: number;
};

const defaultPreferences: PreferencesForm = {
  browserEnabled: false,
  todayFirstEnabled: true,
  deadlineEnabled: true,
  waitingEnabled: true,
  handoverEnabled: true,
  focusEnabled: true,
  shutdownEnabled: false,
  quietHoursEnabled: true,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  nightShiftMode: false,
  timezone: "Asia/Hong_Kong",
  todayReminderTime: "09:00",
  shutdownReminderTime: "21:30",
  deadlineLeadMinutes: 1440
};

const kindLabels: Record<NotificationDelivery["kind"], string> = {
  today_first: "今日第一項",
  deadline: "限期接近",
  waiting_followup: "Waiting 跟進",
  handover_received: "收到交接",
  handover_accepted: "交接接受",
  handover_information: "交接資料",
  handover_returned: "交回上一手",
  handover_completed: "交接步驟完成",
  focus_complete: "Focus 完成",
  daily_shutdown: "每日收尾",
  test: "通知測試"
};

const statusLabels: Record<NotificationDelivery["status"], string> = {
  scheduled: "已安排",
  processing: "發送中",
  retry: "等候重試",
  sent: "已發出",
  opened: "已開啟",
  failed: "未能發出",
  cancelled: "已取消"
};

export function NotificationSettings({
  preferences,
  deliveries,
  activeSubscriptionCount,
  timezone,
  onChanged
}: NotificationSettingsProps) {
  const [form, setForm] = useState<PreferencesForm>(defaultPreferences);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(preferences ? {
      browserEnabled: preferences.browser_enabled,
      todayFirstEnabled: preferences.today_first_enabled,
      deadlineEnabled: preferences.deadline_enabled,
      waitingEnabled: preferences.waiting_enabled,
      handoverEnabled: preferences.handover_enabled,
      focusEnabled: preferences.focus_enabled,
      shutdownEnabled: preferences.shutdown_enabled,
      quietHoursEnabled: preferences.quiet_hours_enabled,
      quietHoursStart: preferences.quiet_hours_start.slice(0, 5),
      quietHoursEnd: preferences.quiet_hours_end.slice(0, 5),
      nightShiftMode: preferences.night_shift_mode,
      timezone: preferences.timezone,
      todayReminderTime: preferences.today_reminder_time.slice(0, 5),
      shutdownReminderTime: preferences.shutdown_reminder_time.slice(0, 5),
      deadlineLeadMinutes: preferences.deadline_lead_minutes
    } : { ...defaultPreferences, timezone: timezone || "Asia/Hong_Kong" });
  }, [preferences, timezone]);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  const available = permission !== "unsupported" && Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const connectionLabel = useMemo(() => {
    if (permission === "unsupported") return "此瀏覽器不支援 Push 通知";
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return "通知服務尚未完成設定";
    if (permission === "denied") return "瀏覽器已封鎖通知";
    if (form.browserEnabled && activeSubscriptionCount > 0) return "已連接此裝置";
    return "尚未啟用";
  }, [activeSubscriptionCount, form.browserEnabled, permission]);

  function set<K extends keyof PreferencesForm>(key: K, value: PreferencesForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(nextForm = form) {
    await controlAction("save_notification_preferences", { preferences: nextForm });
  }

  async function enableNotifications() {
    if (!available) {
      setMessage("目前瀏覽器或伺服器設定未支援 Push 通知。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const requested = await Notification.requestPermission();
      setPermission(requested);
      if (requested !== "granted") {
        setMessage(requested === "denied" ? "通知已被瀏覽器封鎖；可以在網站權限重新允許。" : "你未有授權通知，設定沒有改動。");
        return;
      }
      const registration = await ensureServiceWorker();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!)
        });
      }
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("瀏覽器未有提供完整 Push 訂閱。");
      await controlAction("save_push_subscription", {
        subscription: { endpoint: json.endpoint, keys: json.keys },
        userAgent: navigator.userAgent
      });
      const next = { ...form, browserEnabled: true };
      setForm(next);
      await save(next);
      setMessage("此裝置已啟用私隱通知。鎖屏只會顯示一般提示。");
      await onChanged();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能啟用通知。");
    } finally {
      setBusy(false);
    }
  }

  async function disableNotifications() {
    setBusy(true);
    setMessage("");
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await controlAction("remove_push_subscription", { endpoint: subscription.endpoint });
          await subscription.unsubscribe();
        }
      }
      const next = { ...form, browserEnabled: false };
      setForm(next);
      await save(next);
      setMessage("此裝置通知已關閉；另一個帳戶或裝置不受影響。");
      await onChanged();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能關閉通知。");
    } finally {
      setBusy(false);
    }
  }

  async function savePreferences() {
    setBusy(true);
    setMessage("");
    try {
      await save();
      setMessage("通知時間及類型已儲存。");
      await onChanged();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能儲存通知設定。");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMessage("");
    try {
      await controlAction("test_notification");
      setMessage("測試通知已加入安全發送佇列，通常會在五分鐘內到達。");
      await onChanged();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "未能安排測試通知。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">Browser / PWA Notifications</p>
          <h2 className="section-title mt-1">真正通知系統</h2>
          <p className="muted mt-2 text-sm leading-6">Derek 同 Suki 各自授權、各自設定；所有鎖屏內容只用一般提示。</p>
        </div>
        <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${form.browserEnabled && activeSubscriptionCount ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
          {connectionLabel}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {form.browserEnabled ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void disableNotifications()}>
            <BellOff className="h-5 w-5" />關閉此裝置
          </Button>
        ) : (
          <Button type="button" disabled={busy || !available || permission === "denied"} onClick={() => void enableNotifications()}>
            <Bell className="h-5 w-5" />允許並啟用通知
          </Button>
        )}
        <Button type="button" variant="secondary" disabled={busy || !form.browserEnabled || !activeSubscriptionCount} onClick={() => void sendTest()}>
          <Send className="h-5 w-5" />發送測試
        </Button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NotificationToggle checked={form.todayFirstEnabled} onChange={(value) => set("todayFirstEnabled", value)} title="Today 第一項" />
        <NotificationToggle checked={form.deadlineEnabled} onChange={(value) => set("deadlineEnabled", value)} title="Deadline 接近" />
        <NotificationToggle checked={form.waitingEnabled} onChange={(value) => set("waitingEnabled", value)} title="Waiting 跟進日" />
        <NotificationToggle checked={form.handoverEnabled} onChange={(value) => set("handoverEnabled", value)} title="交接狀態" />
        <NotificationToggle checked={form.focusEnabled} onChange={(value) => set("focusEnabled", value)} title="Focus Timer 完成" />
        <NotificationToggle checked={form.shutdownEnabled} onChange={(value) => set("shutdownEnabled", value)} title="每日收尾" />
      </div>

      <div className="mt-5 grid gap-4 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label><span className="label">Today 提醒</span><input className="field mt-2" type="time" value={form.todayReminderTime} onChange={(event) => set("todayReminderTime", event.target.value)} /></label>
        <label><span className="label">限期提前</span><select className="field mt-2" value={form.deadlineLeadMinutes} onChange={(event) => set("deadlineLeadMinutes", Number(event.target.value))}><option value={0}>到期日當天</option><option value={60}>1 小時前</option><option value={1440}>1 日前</option><option value={4320}>3 日前</option><option value={10080}>7 日前</option></select></label>
        <label><span className="label">收尾提醒</span><input className="field mt-2" type="time" value={form.shutdownReminderTime} onChange={(event) => set("shutdownReminderTime", event.target.value)} disabled={!form.shutdownEnabled} /></label>
        <label><span className="label">時區</span><input className="field mt-2 bg-white" value={form.timezone} readOnly /></label>
      </div>

      <div className="mt-4 grid gap-4 rounded-2xl border border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <NotificationToggle checked={form.quietHoursEnabled} onChange={(value) => set("quietHoursEnabled", value)} title="使用安靜時段" />
        <label><span className="label">安靜開始</span><input className="field mt-2" type="time" value={form.quietHoursStart} onChange={(event) => set("quietHoursStart", event.target.value)} disabled={!form.quietHoursEnabled} /></label>
        <label><span className="label">安靜結束</span><input className="field mt-2" type="time" value={form.quietHoursEnd} onChange={(event) => set("quietHoursEnd", event.target.value)} disabled={!form.quietHoursEnabled} /></label>
        <NotificationToggle checked={form.nightShiftMode} onChange={(value) => set("nightShiftMode", value)} title="Night-shift 模式" />
      </div>
      <p className="muted mt-2 text-xs leading-5">Night-shift 唔會假設夜晚一定休息；實際靜音範圍完全跟上面兩個時間。</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void savePreferences()}>
          <Clock3 className="h-5 w-5" />儲存通知時間及類型
        </Button>
        {message ? <p className="text-sm font-semibold text-slate-600" role="status">{message}</p> : null}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 p-4">
        <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-emerald-600" />最近發送紀錄</p>
        {deliveries.length ? (
          <ul className="mt-3 divide-y divide-slate-100">
            {deliveries.slice(0, 8).map((delivery) => (
              <li key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="font-semibold">{kindLabels[delivery.kind]}</span>
                <span className="muted text-xs">{statusLabels[delivery.status]} · {new Date(delivery.created_at).toLocaleString("zh-HK")}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted mt-2 text-sm">未有通知紀錄。啟用後，已安排、已發出、已開啟或失敗都會記錄。</p>}
      </div>
    </section>
  );
}

function NotificationToggle({ checked, onChange, title }: { checked: boolean; onChange: (value: boolean) => void; title: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <input className="h-5 w-5" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="text-sm font-semibold">{title}</span>
    </label>
  );
}

async function ensureServiceWorker() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return navigator.serviceWorker.ready;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const decoded = window.atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
