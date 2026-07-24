"use client";

import type {
  ControlData,
  InboxProcessingBundle,
  InboxProcessingEvent,
  TaskCheckpointBundle,
  TodayData,
  WeeklyReview,
  WeeklyReviewSummary
} from "@/lib/types";

let refreshInFlight: Promise<void> | null = null;
let lastRefreshAt = 0;

export async function loadControlData(): Promise<ControlData> {
  return controlRequest<ControlData>("/api/control?view=bootstrap", { method: "GET" });
}

export async function loadTodayData(): Promise<TodayData> {
  return controlRequest<TodayData>("/api/control?view=today", { method: "GET" });
}

export async function searchControlData(query: string) {
  return controlRequest<{ results: Array<Record<string, unknown>> }>(`/api/control?view=search&q=${encodeURIComponent(query)}`, { method: "GET" });
}

export async function loadTaskCheckpoints(taskId: string): Promise<TaskCheckpointBundle> {
  return controlRequest<TaskCheckpointBundle>(`/api/control?view=task_checkpoints&taskId=${encodeURIComponent(taskId)}`, { method: "GET" });
}

export async function loadInboxProcessing(
  sessionId: string,
  page = 1
): Promise<InboxProcessingBundle> {
  const params = new URLSearchParams({
    view: "inbox_processing",
    sessionId,
    page: String(page)
  });
  return controlRequest<InboxProcessingBundle>(`/api/control?${params.toString()}`, {
    method: "GET"
  });
}

export async function loadWeeklyReview(weekStart?: string) {
  const params = new URLSearchParams({ view: "weekly_review" });
  if (weekStart) params.set("weekStart", weekStart);
  return controlRequest<WeeklyReviewSummary>(`/api/control?${params.toString()}`, { method: "GET" });
}

export async function saveWeeklyReview(payload: Record<string, unknown>) {
  return controlAction<{ review: WeeklyReview }>("save_weekly_review", payload);
}

export async function processInboxItem(payload: Record<string, unknown>) {
  return controlAction<{
    event: InboxProcessingEvent;
  }>("process_inbox_item", payload);
}

export async function undoLastInboxProcessing(eventId: string) {
  return controlAction<{
    eventId: string;
    restoredInboxItemId: string;
  }>("undo_inbox_processing", { eventId });
}

export async function controlAction<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}) {
  return controlRequest<T>("/api/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload })
  });
}

async function controlRequest<T>(url: string, init: RequestInit): Promise<T> {
  await ensureFreshSession();
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: { ...init.headers }
  });
  const result = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(result.error || "操作失敗，請稍後再試。");
  return result;
}

async function ensureFreshSession() {
  if (Date.now() - lastRefreshAt < 30_000) return;
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin"
    }).then((response) => {
      if (!response.ok) throw new Error("登入已失效，請重新登入。");
      lastRefreshAt = Date.now();
    }).finally(() => {
      refreshInFlight = null;
    });
  }
  await refreshInFlight;
}
