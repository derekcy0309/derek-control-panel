"use client";

import { useCallback, useEffect, useState } from "react";
import { loadControlData } from "@/lib/control-api";
import type { AppData } from "@/lib/types";

const emptyData: AppData = { tasks: [], transactions: [], recurringExpenseRules: [], meetings: [], balances: [], settings: null };

export function useAppData() {
  const [data, setData] = useState<AppData>(emptyData);
  const [userId, setUserId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Array<{ user_id: string; display_name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await loadControlData();
      setUserId(result.currentUser.id);
      setParticipants(result.participants);
      setData({ tasks: result.tasks, transactions: result.transactions, recurringExpenseRules: result.recurringExpenseRules ?? [], meetings: result.meetings, balances: result.balances, settings: result.settings });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "資料讀取失敗。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  return { data, userId, participants, loading, error, reload: load };
}
