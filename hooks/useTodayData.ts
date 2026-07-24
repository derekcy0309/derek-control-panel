"use client";

import { useCallback, useEffect, useState } from "react";
import { loadTodayData } from "@/lib/control-api";
import type { TodayData } from "@/lib/types";

export function useTodayData() {
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loadTodayData());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Today 資料讀取失敗。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
