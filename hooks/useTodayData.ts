"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadTodayData } from "@/lib/control-api";
import { withSavedTask } from "@/lib/today-task-cache";
import type { PersonalTaskTag, Task, TodayData } from "@/lib/types";

export function useTodayData() {
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadedRef = useRef(false);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!loadedRef.current) setLoading(true);
    setError("");
    try {
      const next = await loadTodayData();
      if (currentRequest !== requestId.current) return;
      setData(next);
      loadedRef.current = true;
    } catch (caught) {
      if (currentRequest === requestId.current) {
        setError(caught instanceof Error ? caught.message : "Today 資料讀取失敗。");
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, []);

  const saveTaskLocally = useCallback((task: Task) => {
    // A pending background read must not replace a newer successful save.
    requestId.current += 1;
    setData((current) => current ? withSavedTask(current, task) : current);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const updateTags = (event: Event) => {
      const tags = (event as CustomEvent<{ tags: PersonalTaskTag[] }>).detail?.tags;
      if (!tags) return;
      const active = new Set(tags.map((tag) => tag.id));
      const clean = (task: Task) => ({ ...task, personal_tag_ids: task.personal_tag_ids?.filter((id) => active.has(id)) });
      requestId.current += 1;
      setData((current) => current ? { ...current, taskTags: tags, tasks: current.tasks.map(clean), taskCatalog: current.taskCatalog.map(clean), taskQueueCatalog: current.taskQueueCatalog.map(clean) } : current);
    };
    window.addEventListener("dcp:task-tags-updated", updateTags);
    return () => window.removeEventListener("dcp:task-tags-updated", updateTags);
  }, []);

  return { data, loading, error, reload, saveTaskLocally };
}
