"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadTodayData } from "@/lib/control-api";
import { withSavedTask } from "@/lib/today-task-cache";
import type { PersonalTaskTag, Task, TodayData } from "@/lib/types";

export function useTodayData(progressive = false) {
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailsReady, setDetailsReady] = useState(!progressive);
  const loadedRef = useRef(false);
  const detailsRef = useRef(!progressive);
  const requestId = useRef(0);
  const pending = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    if (!loadedRef.current) setLoading(true);
    setError("");
    try {
      if (progressive && !loadedRef.current) {
        try {
          const focus = await loadTodayData(true, controller.signal);
          if (currentRequest !== requestId.current) return;
          setData(focus);
          loadedRef.current = true;
          setLoading(false);
        } catch {
          // Older Preview/API or a single narrow request failure must not
          // make the whole dashboard unavailable. Still skip an abandoned read.
          if (controller.signal.aborted || currentRequest !== requestId.current) return;
        }
      }
      const next = await loadTodayData(false, controller.signal);
      if (currentRequest !== requestId.current) return;
      setData(next);
      loadedRef.current = true;
      detailsRef.current = true;
      setDetailsReady(true);
    } catch (caught) {
      if (currentRequest === requestId.current) {
        setError(caught instanceof Error ? caught.message : "Today 資料讀取失敗。");
      }
    } finally {
      if (currentRequest === requestId.current) {
        pending.current = null;
        setLoading(false);
      }
    }
  }, [progressive]);

  const saveTaskLocally = useCallback((task: Task) => {
    // A pending background read must not replace a newer successful save.
    requestId.current += 1;
    pending.current?.abort();
    setData((current) => current ? withSavedTask(current, task) : current);
    if (progressive && !detailsRef.current) void reload();
  }, [progressive, reload]);

  useEffect(() => {
    void reload();
    return () => { requestId.current++; pending.current?.abort(); };
  }, [reload]);

  useEffect(() => {
    const updateTags = (event: Event) => {
      const tags = (event as CustomEvent<{ tags: PersonalTaskTag[] }>).detail?.tags;
      if (!tags) return;
      const active = new Set(tags.map((tag) => tag.id));
      const clean = (task: Task) => ({ ...task, personal_tag_ids: task.personal_tag_ids?.filter((id) => active.has(id)) });
      requestId.current += 1;
      pending.current?.abort();
      setData((current) => current ? { ...current, taskTags: tags, tasks: current.tasks.map(clean), taskCatalog: current.taskCatalog.map(clean), taskQueueCatalog: current.taskQueueCatalog.map(clean) } : current);
      if (progressive && !detailsRef.current) void reload();
    };
    window.addEventListener("dcp:task-tags-updated", updateTags);
    return () => window.removeEventListener("dcp:task-tags-updated", updateTags);
  }, [progressive, reload]);

  return { data, loading, error, detailsReady, reload, saveTaskLocally };
}
