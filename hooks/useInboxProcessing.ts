"use client";

import { useCallback, useEffect, useState } from "react";
import { loadInboxProcessing } from "@/lib/control-api";
import type { InboxProcessingBundle } from "@/lib/types";

const sessionStorageKey = "dcp_inbox_processing_session";

export function useInboxProcessing(page: number) {
  const [sessionId, setSessionId] = useState("");
  const [data, setData] = useState<InboxProcessingBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = window.sessionStorage.getItem(sessionStorageKey);
    const nextSessionId = saved || window.crypto.randomUUID();
    if (!saved) window.sessionStorage.setItem(sessionStorageKey, nextSessionId);
    setSessionId(nextSessionId);
  }, []);

  const reload = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError("");
    try {
      setData(await loadInboxProcessing(sessionId, page));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能讀取收集箱。");
    } finally {
      setLoading(false);
    }
  }, [page, sessionId]);

  useEffect(() => {
    let active = true;
    if (!sessionId) return () => { active = false; };
    setLoading(true);
    setError("");
    loadInboxProcessing(sessionId, page)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "未能讀取收集箱。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [page, sessionId]);

  return { sessionId, data, loading, error, reload };
}
