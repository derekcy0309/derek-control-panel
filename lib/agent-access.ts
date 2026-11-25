// Shared validation only. No credentials, service clients or Node-only imports.
export type AgentKind = "task" | "note";
export type AgentTag = { id: string; name: string };
export type AgentGrant = { id: string; label: string; key_fingerprint: string; created_at: string; expires_at: string; revoked_at: string | null; last_used_at: string | null; owner_workspace?: boolean };
export type AgentEvent = { id: string; grant_id: string; action: string; resource_type: AgentKind | null; resource_id: string | null; created_at: string };
export type AgentStatus = { id: string; label: string; expiresAt: string; tags: AgentTag[]; scope?: "school_only" | "owner_workspace"; permissions: { read: boolean; create: boolean; update: boolean; delete: false; requestArchive?: boolean } };
export type AgentItem = { id: string; kind: AgentKind; title: string; description?: string | null; notes?: string | null; due_date?: string | null; status?: string; requested_priority?: number; category?: string | null; tags?: AgentTag[]; created_at?: string };

export const agentKeyPattern = /^dcp_grok_[A-Za-z0-9_-]{43}$/;
export const agentUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const agentMaxGrantDays = 365;
export const agentGrantDays: readonly number[] = [1, 7, 30, 90, agentMaxGrantDays];

// The signed-in browser must never outlive the server-checked grant.
export function agentSessionMaxAge(expiresAt: unknown, now = Date.now()): number | null {
  if (typeof expiresAt !== "string") return null;
  const remaining = Math.floor((Date.parse(expiresAt) - now) / 1000);
  return Number.isFinite(remaining) && remaining > 0 ? Math.min(remaining, agentMaxGrantDays * 86400) : null;
}
export function agentObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function hasOnlyAgentFields(input: Record<string, unknown>, allowed: string[]) { return Object.keys(input).every((key) => allowed.includes(key)); }
function ids(value: unknown, maximum: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximum || value.some((id) => typeof id !== "string" || !agentUuidPattern.test(id))) return null;
  return [...new Set(value as string[])];
}
export function validateAgentGrant(value: unknown) {
  const input = agentObject(value);
  if (!input || !hasOnlyAgentFields(input, ["action", "scope", "label", "days", "taskIds", "noteIds", "tagIds", "acknowledged"])) return { error: "Agent 授權資料不正確。" } as const;
  const label = typeof input.label === "string" ? input.label.trim() : "Grok Bot";
  if (!label || Array.from(label).length > 50 || typeof input.days !== "number" || !agentGrantDays.includes(input.days)) return { error: "請填寫連接名稱及有效期。" } as const;
  // Preserve old clients' deliberately selected grants. A new form with no
  // selection fields gets the owner workspace only after explicit consent.
  const hasSelections = ["taskIds", "noteIds", "tagIds"].some(field => Object.hasOwn(input, field));
  const scope = Object.hasOwn(input, "scope") ? input.scope : hasSelections ? "selected" : "owner_workspace";
  if (scope !== "owner_workspace" && scope !== "selected") return { error: "Agent 授權範圍不正確。" } as const;
  if (input.acknowledged !== true) return { error: "請先確認同意所選的 Agent 存取範圍。" } as const;
  if (scope === "owner_workspace") {
    if (hasSelections) return { error: "本人工作範圍不接受逐項授權清單。" } as const;
    return { data: { scope, label, days: input.days } } as const;
  }
  const taskIds = ids(input.taskIds, 100), noteIds = ids(input.noteIds, 100), tagIds = ids(input.tagIds, 20);
  if (!taskIds || !noteIds || !tagIds?.length) return { error: "請選最少一個可用於新增 Task 的 Tag；每類最多開放 100 項資料。" } as const;
  return { data: { scope, label, days: input.days, taskIds, noteIds, tagIds } } as const;
}

function validDay(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value && !value.startsWith("0000-");
}

export function validateAgentCreate(value: unknown, allowUnlabelled = false) {
  const input = agentObject(value);
  if (!input || (input.kind !== "task" && input.kind !== "note")) return { error: "Agent 只可新增 Task 或 Notes。" } as const;
  const allowed = input.kind === "task" ? ["kind", "requestId", "title", "description", "dueDate", "priority", "tagIds"] : ["kind", "requestId", "title", "description", "category"];
  if (!hasOnlyAgentFields(input, allowed)) return { error: "Agent 不可修改負責人、分享、狀態或其他權限欄位。" } as const;
  if (typeof input.requestId !== "string" || !agentUuidPattern.test(input.requestId)) return { error: "新增識別碼不正確，請重新開啟表單。" } as const;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = input.description == null ? "" : typeof input.description === "string" ? input.description.trim() : null;
  if (!title || Array.from(title).length > 500 || description === null || Array.from(description).length > 10000) return { error: "請填寫名稱（最多 500 字）；內容最多 10,000 字。" } as const;
  if (input.kind === "note") {
    const category = input.category == null ? "" : typeof input.category === "string" ? input.category.trim() : null;
    if (category === null || Array.from(category).length > 40) return { error: "Notes 分類最多 40 字。" } as const;
    return { action: "create_note", payload: { request_id: input.requestId, title, description, category } } as const;
  }
  const dueDate = input.dueDate == null || input.dueDate === "" ? null : input.dueDate;
  if (dueDate !== null && !validDay(dueDate)) return { error: "完成日期不正確；沒有期限可留空。" } as const;
  const priority = input.priority ?? 3;
  const tagIds = allowUnlabelled && !Object.hasOwn(input, "tagIds") ? [] : ids(input.tagIds, 20);
  if (typeof priority !== "number" || ![1, 3, 5].includes(priority) || !tagIds || (!allowUnlabelled && !tagIds.length)) return { error: "請核對 Priority 同可用嘅 Tags。" } as const;
  return { action: "create_task", payload: { request_id: input.requestId, title, description, due_date: dueDate, priority, tag_ids: tagIds } } as const;
}

export function validateAgentUpdate(value: unknown) {
  const input = agentObject(value);
  if (!input || !hasOnlyAgentFields(input, ["kind", "id", "requestId", "changes"])
      || (input.kind !== "task" && input.kind !== "note")
      || typeof input.id !== "string" || !agentUuidPattern.test(input.id)
      || typeof input.requestId !== "string" || !agentUuidPattern.test(input.requestId)) {
    return { error: "修改識別碼或項目類型不正確。" } as const;
  }
  const changes = agentObject(input.changes);
  const task = input.kind === "task";
  if (!changes || !Object.keys(changes).length || !hasOnlyAgentFields(changes,
    task ? ["title", "description", "dueDate", "priority", "status", "tagIds"] : ["title", "description", "category"])) {
    return { error: "只可修改 Task 或記事嘅內容；不可更改設定、擁有權、負責人或分享。" } as const;
  }
  const patch: Record<string, string | number | string[] | null> = {};
  for (const field of ["title", "description", "category"] as const) {
    if (!Object.hasOwn(changes, field)) continue;
    const raw = changes[field];
    const trimmed = typeof raw === "string" ? raw.trim() : null;
    const max = field === "title" ? 500 : field === "description" ? 10_000 : 40;
    if (trimmed === null || (field === "title" && !trimmed) || Array.from(trimmed).length > max) {
      return { error: "請核對名稱及內容長度。" } as const;
    }
    patch[field] = trimmed;
  }
  if (Object.hasOwn(changes, "dueDate")) {
    if (changes.dueDate === null || changes.dueDate === "") patch.due_date = null;
    else if (typeof changes.dueDate === "string" && validDay(changes.dueDate)) patch.due_date = changes.dueDate;
    else return { error: "完成日期不正確；如無期限請留空。" } as const;
  }
  if (Object.hasOwn(changes, "priority")) {
    if (typeof changes.priority !== "number" || ![1, 3, 5].includes(changes.priority)) return { error: "Priority 不正確。" } as const;
    patch.priority = changes.priority;
  }
  if (Object.hasOwn(changes, "status")) {
    if (typeof changes.status !== "string" || !["not_started", "in_progress", "waiting", "blocked", "done", "cancelled"].includes(changes.status)) {
      return { error: "Task 狀態不正確。" } as const;
    }
    patch.status = changes.status;
  }
  if (Object.hasOwn(changes, "tagIds")) {
    const parsed = ids(changes.tagIds, 20);
    if (!parsed) return { error: "Tags 不正確；每項最多 20 個。" } as const;
    patch.tag_ids = parsed;
  }
  return { action: "update", payload: { kind: input.kind, id: input.id, request_id: input.requestId, changes: patch } } as const;
}

export function validateAgentArchiveRequest(value: unknown) {
  const input = agentObject(value);
  if (!input || !hasOnlyAgentFields(input, ["action", "kind", "id"]) || input.action !== "request_archive"
      || (input.kind !== "task" && input.kind !== "note") || typeof input.id !== "string" || !agentUuidPattern.test(input.id)) {
    return { error: "請只指定一項 Task 或記事；封存要由本人喺日序確認。" } as const;
  }
  return { action: "request_archive", payload: { kind: input.kind, id: input.id } } as const;
}
