"use client";

export type OfflineCheckpointPayload = {
  taskId: string;
  completedSummary: string | null;
  currentPosition: string | null;
  nextMinimumStep: string | null;
  resourceLinks: Array<{ label: string; url: string }>;
  blockedReason: string | null;
};

type OfflineWriteKind = "checkpoint" | "quick_capture" | "focus_pause" | "focus_finish";
type OfflineWriteState = "queued" | "conflict";

type CheckpointWrite = {
  kind: "checkpoint";
  payload: OfflineCheckpointPayload & { state: "draft" | "saved"; clientMutationId: string };
};

type QuickCaptureWrite = {
  kind: "quick_capture";
  payload: {
    clientCaptureId: string;
    title: string;
    description: string;
    area: "work" | "family" | "personal";
    source: "text" | "voice" | "photo" | "document" | "web";
    targetUserId: string | null;
    sourceUrl: string | null;
  };
};

type FocusPauseWrite = {
  kind: "focus_pause";
  payload: { taskId: string; actualMinutes: number; expectedLastProgressAt: string | null; sessionId: string | null };
};

type FocusFinishWrite = {
  kind: "focus_finish";
  payload: {
    taskId: string;
    taskChanges: Record<string, unknown> | null;
    expectedLastProgressAt: string | null;
    sessionId: string | null;
    status: "completed" | "partial" | "interrupted";
    checkpointClientMutationId: string;
    blockReason: string | null;
  };
};

type OfflineWritePayload = CheckpointWrite | QuickCaptureWrite | FocusPauseWrite | FocusFinishWrite;

export type OfflineWriteEntry = OfflineWritePayload & {
  id: string;
  userId: string;
  state: OfflineWriteState;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lastError: string | null;
};

export type OfflineQueueStatus = {
  queued: number;
  conflicts: number;
  online: boolean;
};

const databaseName = "dcp-offline-write-queue-v1";
const storeName = "writes";
const changeEvent = "dcp-offline-queue-change";
const syncInFlight = new Map<string, Promise<OfflineQueueStatus>>();

export function isOffline() {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

export async function queueCheckpointWrite(
  userId: string,
  state: "draft" | "saved",
  payload: OfflineCheckpointPayload
) {
  const entries = await entriesForUser(userId);
  const existing = state === "draft"
    ? entries.find((entry) => entry.kind === "checkpoint" && entry.state === "queued" && entry.payload.state === "draft" && entry.payload.taskId === payload.taskId)
    : undefined;
  const now = new Date().toISOString();
  const clientMutationId = existing?.kind === "checkpoint" ? existing.payload.clientMutationId : createId();
  const entry: OfflineWriteEntry = {
    id: existing?.id ?? createId(),
    userId,
    kind: "checkpoint",
    payload: { ...payload, state, clientMutationId },
    state: "queued",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    attempts: existing?.attempts ?? 0,
    lastError: null
  };
  await putEntry(entry);
  announceChange();
  return { entry, clientMutationId };
}

export async function queueQuickCapture(
  userId: string,
  payload: QuickCaptureWrite["payload"]
) {
  const entry = newEntry(userId, "quick_capture", payload);
  await putEntry(entry);
  announceChange();
  return entry;
}

export async function queueFocusPause(
  userId: string,
  payload: FocusPauseWrite["payload"]
) {
  const entries = await entriesForUser(userId);
  const existing = entries.find((entry) => entry.kind === "focus_pause" && entry.state === "queued" && entry.payload.sessionId === payload.sessionId && entry.payload.taskId === payload.taskId);
  const entry = existing
    ? { ...existing, payload, updatedAt: new Date().toISOString(), lastError: null } as OfflineWriteEntry
    : newEntry(userId, "focus_pause", payload);
  await putEntry(entry);
  announceChange();
  return entry;
}

export async function queueFocusFinish(
  userId: string,
  payload: FocusFinishWrite["payload"]
) {
  const entries = await entriesForUser(userId);
  const existing = entries.find((entry) => entry.kind === "focus_finish" && entry.state === "queued" && entry.payload.sessionId === payload.sessionId && entry.payload.taskId === payload.taskId);
  const entry = existing
    ? { ...existing, payload, updatedAt: new Date().toISOString(), lastError: null } as OfflineWriteEntry
    : newEntry(userId, "focus_finish", payload);
  await putEntry(entry);
  announceChange();
  return entry;
}

export async function getOfflineQueueStatus(userId: string | null): Promise<OfflineQueueStatus> {
  if (!userId) return { queued: 0, conflicts: 0, online: !isOffline() };
  const entries = await entriesForUser(userId);
  return {
    queued: entries.filter((entry) => entry.state === "queued").length,
    conflicts: entries.filter((entry) => entry.state === "conflict").length,
    online: !isOffline()
  };
}

export async function synchronizeOfflineWrites(userId: string): Promise<OfflineQueueStatus> {
  if (isOffline()) return getOfflineQueueStatus(userId);
  const existing = syncInFlight.get(userId);
  if (existing) return existing;

  const work = synchronize(userId).finally(() => syncInFlight.delete(userId));
  syncInFlight.set(userId, work);
  return work;
}

export async function clearOfflineWrites(userId: string) {
  const entries = await entriesForUser(userId);
  await Promise.all(entries.map((entry) => deleteEntry(entry.id)));
  announceChange();
}

export async function discardConflictedOfflineWrites(userId: string) {
  const entries = await entriesForUser(userId);
  await Promise.all(entries.filter((entry) => entry.state === "conflict").map((entry) => deleteEntry(entry.id)));
  announceChange();
}

export function subscribeOfflineQueue(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(changeEvent, listener);
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

async function synchronize(userId: string) {
  const session = await fetch("/api/auth", { method: "GET", cache: "no-store", credentials: "same-origin" })
    .then(async (response) => ({ response, body: await response.json().catch(() => ({})) as { user?: { id?: string } } }))
    .catch(() => null);
  if (!session) return getOfflineQueueStatus(userId);
  if (!session.response.ok || session.body.user?.id !== userId) {
    await markQueuedEntriesAsConflict(userId, "需要以原本帳戶登入後才可安全同步。\n");
    return getOfflineQueueStatus(userId);
  }

  const entries = (await entriesForUser(userId))
    .filter((entry) => entry.state === "queued")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  for (const entry of entries) {
    try {
      await replay(entry);
      await deleteEntry(entry.id);
      announceChange();
    } catch (caught) {
      const failure = caught instanceof OfflineReplayFailure ? caught : new OfflineReplayFailure("retry", "網絡仍未穩定，會在下次連線時再試。");
      if (failure.kind === "conflict") {
        await putEntry({ ...entry, state: "conflict", attempts: entry.attempts + 1, updatedAt: new Date().toISOString(), lastError: failure.message });
        announceChange();
        continue;
      }
      await putEntry({ ...entry, attempts: entry.attempts + 1, updatedAt: new Date().toISOString(), lastError: failure.message });
      announceChange();
      break;
    }
  }
  return getOfflineQueueStatus(userId);
}

async function replay(entry: OfflineWriteEntry) {
  if (entry.kind === "checkpoint") {
    await postControl({
      action: entry.payload.state === "draft" ? "save_checkpoint_draft" : "save_checkpoint",
      ...entry.payload
    });
    return;
  }
  if (entry.kind === "quick_capture") {
    const form = new FormData();
    form.set("clientCaptureId", entry.payload.clientCaptureId);
    form.set("title", entry.payload.title);
    form.set("description", entry.payload.description);
    form.set("area", entry.payload.area);
    form.set("source", entry.payload.source);
    if (entry.payload.targetUserId) form.set("targetUserId", entry.payload.targetUserId);
    if (entry.payload.sourceUrl) form.set("sourceUrl", entry.payload.sourceUrl);
    await postCapture(form);
    return;
  }
  if (entry.kind === "focus_pause") {
    await postControl({
      action: "update_task",
      id: entry.payload.taskId,
      expectedLastProgressAt: entry.payload.expectedLastProgressAt,
      changes: { actual_minutes: entry.payload.actualMinutes }
    });
    if (entry.payload.sessionId) await postControl({ action: "pause_focus_session", sessionId: entry.payload.sessionId });
    return;
  }
  if (entry.payload.taskChanges) {
    await postControl({
      action: "update_task",
      id: entry.payload.taskId,
      expectedLastProgressAt: entry.payload.expectedLastProgressAt,
      changes: entry.payload.taskChanges
    });
  }
  if (entry.payload.sessionId) {
    await postControl({
      action: "finish_focus_session_after_checkpoint",
      sessionId: entry.payload.sessionId,
      status: entry.payload.status,
      checkpointClientMutationId: entry.payload.checkpointClientMutationId,
      blockReason: entry.payload.blockReason
    });
  }
}

async function postControl(body: Record<string, unknown>) {
  const response = await fetch("/api/control", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw responseFailure(response.status, result.error);
}

async function postCapture(body: FormData) {
  const response = await fetch("/api/quick-capture", { method: "POST", cache: "no-store", credentials: "same-origin", body });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw responseFailure(response.status, result.error);
}

function responseFailure(status: number, message?: string) {
  if ([400, 401, 403, 404, 409, 422].includes(status)) {
    const safeMessage = message === "OFFLINE_TASK_CONFLICT"
      ? "伺服器已有較新的任務進度；未有自動覆蓋，請重新開啟任務後處理。"
      : "這筆離線寫入需要重新確認；系統未有自動覆蓋現有資料。";
    return new OfflineReplayFailure("conflict", safeMessage);
  }
  return new OfflineReplayFailure("retry", "網絡或伺服器暫時未能同步，會保留在此裝置稍後再試。");
}

class OfflineReplayFailure extends Error {
  constructor(readonly kind: "retry" | "conflict", message: string) {
    super(message);
  }
}

function newEntry<K extends OfflineWriteKind>(
  userId: string,
  kind: K,
  payload: Extract<OfflineWritePayload, { kind: K }>["payload"]
) {
  const now = new Date().toISOString();
  return {
    id: createId(),
    userId,
    kind,
    payload,
    state: "queued",
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    lastError: null
  } as Extract<OfflineWriteEntry, { kind: K }>;
}

async function markQueuedEntriesAsConflict(userId: string, message: string) {
  const entries = await entriesForUser(userId);
  await Promise.all(entries.filter((entry) => entry.state === "queued").map((entry) => putEntry({
    ...entry,
    state: "conflict",
    attempts: entry.attempts + 1,
    updatedAt: new Date().toISOString(),
    lastError: message
  })));
  announceChange();
}

async function entriesForUser(userId: string): Promise<OfflineWriteEntry[]> {
  if (typeof indexedDB === "undefined") return [];
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readonly");
  const request = transaction.objectStore(storeName).index("by_user").getAll(userId);
  return requestResult<OfflineWriteEntry[]>(request);
}

async function putEntry(entry: OfflineWriteEntry) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(entry);
  await transactionDone(transaction);
}

async function deleteEntry(id: string) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).delete(id);
  await transactionDone(transaction);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, { keyPath: "id" });
      store.createIndex("by_user", "userId", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("未能開啟離線儲存空間。"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("離線資料讀取失敗。"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("離線資料未能儲存。"));
    transaction.onerror = () => reject(transaction.error ?? new Error("離線資料未能儲存。"));
  });
}

function announceChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(changeEvent));
}

function createId() {
  return crypto.randomUUID();
}
