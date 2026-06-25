"use client";

import { useEffect, useState } from "react";
import { Download, Save } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { LoadingState } from "@/components/LoadingState";
import { Button } from "@/components/ui/Button";
import { downloadCsv } from "@/lib/csv";
import { formatDate } from "@/lib/date";
import {
  expenseStatusLabels,
  frequencyLabels,
  incomeStatusLabels,
  reminderDayLabels,
  riskLabels,
  scopeLabels,
  sourceTypeLabels,
  taskStatusLabels,
  transactionTypeLabels
} from "@/lib/labels";
import { supabase } from "@/lib/supabase";
import type { ReminderDays } from "@/lib/types";
import { useAppData } from "@/hooks/useAppData";

export default function SettingsPage() {
  return (
    <AuthGate>
      <SettingsContent />
    </AuthGate>
  );
}

function SettingsContent() {
  const { data, userId, loading, error, reload } = useAppData();
  const [email, setEmail] = useState("");
  const [dailyReminderTime, setDailyReminderTime] = useState("09:00");
  const [defaultReminderDays, setDefaultReminderDays] = useState<ReminderDays>(3);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (data.settings) {
      setEmail(data.settings.email ?? "");
      setDailyReminderTime(data.settings.daily_reminder_time ?? "09:00");
      setDefaultReminderDays(data.settings.default_reminder_days ?? 3);
    }
  }, [data.settings]);

  if (loading || error || !userId) return <LoadingState error={error} />;

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const payload = {
      user_id: userId,
      email: email.trim() || null,
      daily_reminder_time: dailyReminderTime,
      default_reminder_days: defaultReminderDays
    };

    const result = data.settings
      ? await supabase?.from("user_settings").update(payload).eq("id", data.settings.id)
      : await supabase?.from("user_settings").insert(payload);

    if (result?.error) {
      setMessage("儲存設定失敗，請稍後再試。");
      return;
    }

    setMessage("設定已儲存。第一版不會發送電郵提醒，只會保留你的偏好。");
    reload();
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-white p-5 shadow-soft">
        <p className="text-sm font-semibold text-indigo-600">私人偏好</p>
        <h2 className="mt-1 text-2xl font-bold text-ink">設定</h2>
        <p className="mt-2 text-base text-slate-600">第一版不會發送電郵提醒，但會先保存提醒時間和預設日數。</p>
      </section>

      <form className="panel grid gap-4 p-5" onSubmit={saveSettings}>
        <label>
          <span className="label">使用者電郵</span>
          <input className="field mt-2" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="你的電郵地址" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="label">每日提醒時間</span>
            <input className="field mt-2" type="time" value={dailyReminderTime} onChange={(event) => setDailyReminderTime(event.target.value)} />
          </label>
          <label>
            <span className="label">預設提醒日數</span>
            <select className="field mt-2" value={defaultReminderDays} onChange={(event) => setDefaultReminderDays(Number(event.target.value) as ReminderDays)}>
              <option value={7}>{reminderDayLabels[7]}</option>
              <option value={3}>{reminderDayLabels[3]}</option>
              <option value={1}>{reminderDayLabels[1]}</option>
            </select>
          </label>
        </div>
        <Button type="submit">
          <Save className="h-5 w-5" />
          儲存設定
        </Button>
        {message ? <p className="rounded-lg bg-indigo-50 p-3 text-base font-semibold text-indigo-800">{message}</p> : null}
      </form>

      <section className="panel p-5">
        <h3 className="text-xl font-bold text-ink">匯出 CSV</h3>
        <p className="mt-2 text-base text-slate-600">匯出目前未封存的資料，方便備份或用試算表查看。</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => exportTasks(data.tasks)}>
            <Download className="h-5 w-5" />
            匯出任務
          </Button>
          <Button variant="secondary" onClick={() => exportTransactions(data.transactions)}>
            <Download className="h-5 w-5" />
            匯出收入支出
          </Button>
          <Button variant="secondary" onClick={() => exportMeetings(data.meetings)}>
            <Download className="h-5 w-5" />
            匯出會議
          </Button>
        </div>
      </section>
    </div>
  );
}

function exportTasks(tasks: import("@/lib/types").Task[]) {
  downloadCsv(
    "任務.csv",
    tasks.map((task) => ({
      標題: task.title,
      家庭公司: scopeLabels[task.scope],
      類型: sourceTypeLabels[task.source_type],
      負責人: task.owner,
      到期日: formatDate(task.due_date),
      跟進日: formatDate(task.follow_up_date),
      狀態: taskStatusLabels[task.status],
      風險: riskLabels[task.risk],
      下一步: task.next_action,
      備註: task.notes
    }))
  );
}

function exportTransactions(transactions: import("@/lib/types").Transaction[]) {
  downloadCsv(
    "收入支出.csv",
    transactions.map((item) => ({
      項目: item.item,
      家庭公司: scopeLabels[item.scope],
      類型: transactionTypeLabels[item.type],
      分類: item.category,
      金額: item.amount,
      預計日期: formatDate(item.expected_date),
      實際日期: formatDate(item.actual_date),
      頻率: frequencyLabels[item.frequency],
      狀態: item.type === "income" ? incomeStatusLabels[item.status as keyof typeof incomeStatusLabels] : expenseStatusLabels[item.status as keyof typeof expenseStatusLabels],
      付款方式: item.payment_method,
      負責人: item.owner,
      證明連結: item.proof_url,
      備註: item.notes
    }))
  );
}

function exportMeetings(meetings: import("@/lib/types").Meeting[]) {
  downloadCsv(
    "會議.csv",
    meetings.map((meeting) => ({
      會議名稱: meeting.meeting_name,
      家庭公司: scopeLabels[meeting.scope],
      會議日期: formatDate(meeting.meeting_date),
      粗略會議內容: meeting.raw_notes,
      手動摘要: meeting.summary
    }))
  );
}
