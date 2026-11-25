"use client";

import { checkClientSession, clearClientSessionCheck } from "@/lib/client-session";
import type {
  BodyDoubleData,
  AdminAccountUser,
  CalendarPanelData,
  ControlData,
  ControlShellData,
  FocusSession,
  PersonalTaskTag,
  InboxCaptureFile,
  InboxProcessingBundle,
  InboxProcessingEvent,
  TaskCheckpointBundle,
  TaskDetailData,
  TaskResourceBundle,
  TimeEstimateSuggestion,
  Transaction,
  TodayData,
  WeeklyReview,
  WeeklyReviewSummary
} from "@/lib/types";

export async function loadControlData(): Promise<ControlData> {
  return controlRequest<ControlData>("/api/control?view=bootstrap", { method: "GET" });
}

export async function loadControlShellData(signal?: AbortSignal): Promise<ControlShellData> {
  return controlRequest<ControlShellData>("/api/control?view=shell", { method: "GET", signal });
}

export function loadCalendarPanelData(month: string, signal?: AbortSignal) {
  return controlRequest<CalendarPanelData>(`/api/control?view=calendar&month=${encodeURIComponent(month)}`, { method: "GET", signal });
}

export async function loadAdminAccountUsers(): Promise<{ users: AdminAccountUser[]; truncated: boolean; currentUserId: string }> {
  return controlRequest<{ users: AdminAccountUser[]; truncated: boolean; currentUserId: string }>("/api/admin/users", { method: "GET" });
}

export async function updateAdminEncouragementVisibility(targetUserId: string, visible: boolean) {
  return controlRequest<{ targetUserId: string; showEncouragement: boolean }>("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "set_encouragement_visibility", targetUserId, visible })
  });
}

export async function deleteAdminAccount(targetUserId: string, confirmEmail: string) {
  return controlRequest<{ deletedUserId: string }>("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete_account", targetUserId, confirmEmail })
  });
}

export async function loadTodayData(focusOnly = false, signal?: AbortSignal): Promise<TodayData> {
  return controlRequest<TodayData>(`/api/control?view=${focusOnly ? "today_focus" : "today"}`, { method: "GET", signal });
}

export async function loadTaskTags(taskId?: string) {
  return controlRequest<{ tags: PersonalTaskTag[]; taskTagIds: string[] }>(
    `/api/control?view=task_tags${taskId ? `&taskId=${encodeURIComponent(taskId)}` : ""}`, { method: "GET" }
  );
}

export async function loadTaskDetail(taskId: string): Promise<TaskDetailData> {
  return controlRequest<TaskDetailData>(
    `/api/control?view=task_detail&taskId=${encodeURIComponent(taskId)}`,
    { method: "GET" }
  );
}

export function loadWorkGuide(taskId: string, withLaunch = false) {
  return controlRequest<import("./work-guide").GuideDetail & { launch?: import("./launch-resource").LaunchTarget | null; launchUnavailable?: boolean }>(`/api/control?view=work_guide&taskId=${encodeURIComponent(taskId)}${withLaunch?"&launch=1":""}`, {method:"GET"});
}

export type AssignmentAlertRecord = {
  id: string;
  resource_id: string;
  assigned_by_id: string;
  assigned_to_id: string;
  status: string;
  due_date: string | null;
  work_dates?: string[] | null;
  accepted_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string | null;
  task_active: boolean;
};

export async function loadAssignmentAlerts(): Promise<{ assignments: AssignmentAlertRecord[]; currentUserId: string; quietModeUntil: string | null }> {
  return controlRequest<{ assignments: AssignmentAlertRecord[]; currentUserId: string; quietModeUntil: string | null }>(
    "/api/control?view=assignment_alerts", { method: "GET" }
  );
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
  return controlRequest<{ userId: string; auditRecorded: boolean }>("/api/admin/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function controlRequest<T>(url: string, init: RequestInit): Promise<T> {
  if (!await checkClientSession()) throw new Error("登入已失效，請重新登入。");
  init.signal?.throwIfAborted();
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: { ...init.headers }
  });
  if (response.status === 401) clearClientSessionCheck();
  const result = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(result.error || "操作失敗，請稍後再試。");
  return result;
}

export type CoachMessage = { role: "user" | "assistant"; content: string };

export function askTaskCoach(input: { title: string; step: string; progress: string; messages: CoachMessage[] }) {
  return controlRequest<{reply:string}>("/api/ai/task-coach", {
    method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(input)
  });
}
