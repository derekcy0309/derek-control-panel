"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkpointFormFromRecord,
  checkpointFormKey,
  checkpointPayload,
  emptyCheckpointForm,
  hasCheckpointContent,
  type CheckpointForm
} from "@/lib/checkpoints";
import { controlAction, loadTaskCheckpoints } from "@/lib/control-api";
import type { TaskCheckpoint, TaskCheckpointBundle } from "@/lib/types";

export type CheckpointSaveState = "idle" | "pending" | "saving" | "saved" | "error";

export function useTaskCheckpoint(taskId: string) {
  const [bundle, setBundle] = useState<TaskCheckpointBundle>({ latest: null, draft: null, history: [] });
  const [form, setForm] = useState<CheckpointForm>(emptyCheckpointForm);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveState, setSaveState] = useState<CheckpointSaveState>("idle");
  const formRef = useRef(form);
  const readyRef = useRef(false);
  const lastSavedKeyRef = useRef(checkpointFormKey(form));
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveRevisionRef = useRef(0);
  const autoSaveTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    readyRef.current = false;
    try {
      const nextBundle = await loadTaskCheckpoints(taskId);
      const loadedForm = nextBundle.draft ? checkpointFormFromRecord(nextBundle.draft) : emptyCheckpointForm();
      formRef.current = loadedForm;
      lastSavedKeyRef.current = checkpointFormKey(loadedForm);
      setForm(loadedForm);
      setBundle(nextBundle);
      setSaveState(nextBundle.draft ? "saved" : "idle");
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "未能讀取上次工作記錄。");
    } finally {
      readyRef.current = true;
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);

  const persist = useCallback((
    snapshot: CheckpointForm,
    state: "draft" | "saved",
    revision: number
  ): Promise<TaskCheckpoint | null> => {
    const { parsed, payload } = checkpointPayload(snapshot);
    if (parsed.error) {
      setSaveError(parsed.error);
      setSaveState("error");
      return Promise.resolve(null);
    }
    if (state === "saved" && !hasCheckpointContent(snapshot)) {
      setSaveError("請至少填寫目前進度或下一個最小步驟。");
      setSaveState("error");
      return Promise.resolve(null);
    }

    let resolveResult: (saved: TaskCheckpoint | null) => void = () => undefined;
    const result = new Promise<TaskCheckpoint | null>((resolve) => { resolveResult = resolve; });
    saveQueueRef.current = saveQueueRef.current.catch(() => undefined).then(async () => {
      if (revision === saveRevisionRef.current) {
        setSaveState("saving");
        setSaveError("");
      }
      try {
        const response = await controlAction<{ checkpoint: TaskCheckpoint }>(
          state === "draft" ? "save_checkpoint_draft" : "save_checkpoint",
          { taskId, ...payload }
        );
        if (state === "draft") {
          lastSavedKeyRef.current = checkpointFormKey(snapshot);
          setBundle((current) => ({ ...current, draft: response.checkpoint }));
        } else {
          const cleared = emptyCheckpointForm();
          formRef.current = cleared;
          lastSavedKeyRef.current = checkpointFormKey(cleared);
          setForm(cleared);
          setBundle((current) => ({
            latest: response.checkpoint,
            draft: null,
            history: [response.checkpoint, ...current.history.filter((item) => item.id !== response.checkpoint.id)].slice(0, 20)
          }));
        }
        if (revision === saveRevisionRef.current) setSaveState("saved");
        resolveResult(response.checkpoint);
      } catch (caught) {
        if (revision === saveRevisionRef.current) {
          setSaveError(caught instanceof Error ? caught.message : "未能儲存工作記錄。");
          setSaveState("error");
        }
        resolveResult(null);
      }
    });
    return result;
  }, [taskId]);

  useEffect(() => {
    if (!readyRef.current) return;
    const key = checkpointFormKey(form);
    if (key === lastSavedKeyRef.current) return;
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    setSaveState("pending");
    autoSaveTimerRef.current = window.setTimeout(() => {
      const revision = ++saveRevisionRef.current;
      void persist(form, "draft", revision);
    }, 900);
    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, [form, persist]);

  const updateField = useCallback(<K extends keyof CheckpointForm>(field: K, value: CheckpointForm[K]) => {
    setForm((current) => {
      const next = { ...current, [field]: value };
      formRef.current = next;
      return next;
    });
  }, []);

  const flushDraft = useCallback(() => {
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    const snapshot = formRef.current;
    if (checkpointFormKey(snapshot) === lastSavedKeyRef.current) return Promise.resolve(true);
    const revision = ++saveRevisionRef.current;
    return persist(snapshot, "draft", revision).then(Boolean);
  }, [persist]);

  const saveCheckpoint = useCallback((overrides: Partial<CheckpointForm> = {}) => {
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    const snapshot = { ...formRef.current, ...overrides };
    formRef.current = snapshot;
    setForm(snapshot);
    const revision = ++saveRevisionRef.current;
    return persist(snapshot, "saved", revision);
  }, [persist]);

  return {
    ...bundle,
    form,
    loading,
    loadError,
    saveError,
    saveState,
    updateField,
    flushDraft,
    saveCheckpoint,
    retryLoad: load
  };
}
