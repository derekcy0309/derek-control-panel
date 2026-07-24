"use client";

import { useCallback, useEffect, useState } from "react";
import { loadControlData } from "@/lib/control-api";
import type { ControlData } from "@/lib/types";

export function useControlData() {
  const [data, setData] = useState<ControlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loadControlData());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "資料讀取失敗。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { data, loading, error, reload };
}
