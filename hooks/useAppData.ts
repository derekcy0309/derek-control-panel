"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { AppData, Balance, Meeting, Task, Transaction, UserSettings } from "@/lib/types";

const emptyData: AppData = {
  tasks: [],
  transactions: [],
  meetings: [],
  balances: [],
  settings: null
};

export function useAppData() {
  const [data, setData] = useState<AppData>(emptyData);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError("");

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setError("未能讀取登入使用者。");
      setLoading(false);
      return;
    }

    setUserId(userData.user.id);
    const [tasks, transactions, meetings, balances, settings] = await Promise.all([
      supabase.from("tasks").select("*").is("archived_at", null).order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("transactions").select("*").is("archived_at", null).order("expected_date", { ascending: true, nullsFirst: false }),
      supabase.from("meetings").select("*").is("archived_at", null).order("meeting_date", { ascending: false }),
      supabase.from("balances").select("*").is("archived_at", null).order("month", { ascending: false }),
      supabase.from("user_settings").select("*").maybeSingle()
    ]);

    const firstError = [
      { name: "tasks", label: "任務", error: tasks.error },
      { name: "transactions", label: "收入支出", error: transactions.error },
      { name: "meetings", label: "會議", error: meetings.error },
      { name: "balances", label: "期初結餘", error: balances.error },
      { name: "user_settings", label: "設定", error: settings.error }
    ].find((item) => item.error);

    if (firstError) {
      setError(formatSupabaseReadError(firstError.label, firstError.name, firstError.error));
    } else {
      setData({
        tasks: (tasks.data ?? []) as Task[],
        transactions: (transactions.data ?? []) as Transaction[],
        meetings: (meetings.data ?? []) as Meeting[],
        balances: (balances.data ?? []) as Balance[],
        settings: (settings.data ?? null) as UserSettings | null
      });
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, userId, loading, error, reload: load };
}

function formatSupabaseReadError(label: string, tableName: string, error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const message = typeof error === "object" && error && "message" in error ? String(error.message) : "";

  if (code === "PGRST205" || message.includes("Could not find the table")) {
    return `Supabase 尚未建立「${label}」資料表。請到 Supabase SQL Editor 執行 supabase/schema.sql，然後重新整理頁面。`;
  }

  return `資料讀取失敗：「${label}」資料表無法讀取。請檢查 Supabase 權限或資料表 ${tableName}。`;
}
