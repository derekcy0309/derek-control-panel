"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadControlData } from "@/lib/control-api";
import type { ControlData, OperatingItem } from "@/lib/types";

export function useControlData() {
  const [data, setData] = useState<ControlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadedRef = useRef(false);

  const reload = useCallback(async () => {
    if (!loadedRef.current) setLoading(true);
    setError("");
    try {
      setData(await loadControlData());
      loadedRef.current = true;
    } catch (caught) {
      if (!loadedRef.current) setError(caught instanceof Error ? caught.message : "資料讀取失敗。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  const upsertOperatingItem = useCallback((item: OperatingItem) => {
    setData((current) => current ? { ...current, operatingItems: [...current.operatingItems.filter((entry) => entry.id !== item.id), item] } : current);
  }, []);
  return { data, loading, error, reload, upsertOperatingItem };
}
