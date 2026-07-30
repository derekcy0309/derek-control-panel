"use client";

import type {
  BodyDoubleData,
  ControlData,
  FocusSession,
  InboxCaptureFile,
  InboxProcessingBundle,
  InboxProcessingEvent,
  TaskCheckpointBundle,
  TaskResourceBundle,
  TimeEstimateSuggestion,
  Transaction,
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

export async function loadArchivedTransactions(page = 1) {
  return controlRequest<{ transactions: Transaction[]; page: number; hasMore: boolean }>(
    `/api/control?view=archived_transactions&page=${encodeURIComponent(String(page))}`,
    { method: "GET" }
  );
}

export async function searchControlData(query: string) {
  return controlRequest<{ results: Array<Record<string, unknown>> }>(`/api/control?view=search&q=${encodeURIComponent(query)}`, { method: "GET" });
}

export async function loadTaskCheckpoints(taskId: string): Promise<TaskCheckpointBundle> {
  return controlRequest<TaskCheckpointBundle>(`/api/control?view=task_checkpoints&taskId=${encodeURIComponent(taskId)}`, { method: "GET" });
}

export async function loadTaskResources(taskId: string): Promise<TaskResourceBundle> {
  return controlRequest<TaskResourceBundle>(`/api/control?view=task_resources&taskId=${encodeURIComponent(taskId)}`, { method: "GET" });
}

export async function loadTimeEstimateSuggestion(input: {
  sourceType: string;
  context: string;
  energyLevel: string;
  estimatedMinutes: number;
}): Promise<{ suggestion: TimeEstimateSuggestion | null }> {
  const params = new URLSearchParams({
    view: "time_estimate_suggestion",
    sourceType: input.sourceType,
    context: input.context,
    energyLevel: input.energyLevel,
    estimatedMinutes: String(input.estimatedMinutes)
  });
  return controlRequest<{ suggestion: TimeEstimateSuggestion | null }>(`/api/control?${params.toString()}`, { method: "GET" });
}

export async function loadFocusSessions(taskId: string): Promise<{ sessions: FocusSession[] }> {
  return controlRequest<{ sessions: FocusSession[] }>(`/api/control?view=focus_sessions&taskId=${encodeURIComponent(taskId)}`, { method: "GET" });
}

export async function loadInboxCaptureFiles(inboxItemId: string): Promise<{ files: InboxCaptureFile[] }> {
  return controlRequest<{ files: InboxCaptureFile[] }>("/api/control?view=inbox_capture_files&inboxItemId=" + encodeURIComponent(inboxItemId), { method: "GET" });
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

export async function loadBodyDouble(sessionId?: string) {
  const params = new URLSearchParams({ view: "body_double" });
  if (sessionId) params.set("sessionId", sessionId);
  return controlRequest<BodyDoubleData>(`/api/control?${params.toString()}`, { method: "GET" });
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

export async function invitePortalUser(payload: { email: string; displayName: string }) {
  return controlRequest<{ userId: string }>("/api/admin/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
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
