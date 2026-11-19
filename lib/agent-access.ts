// Shared validation only. No credentials, service clients or Node-only imports.
export type AgentKind = "task" | "note";
export type AgentTag = { id: string; name: string };
export type AgentGrant = { id: string; label: string; key_fingerprint: string; created_at: string; expires_at: string; revoked_at: string | null; last_used_at: string | null };
export type AgentEvent = { id: string; grant_id: string; action: string; resource_type: AgentKind | null; resource_id: string | null; created_at: string };
export type AgentStatus = { id: string; label: string; expiresAt: string; tags: AgentTag[]; scope?: "school_only"; permissions: { read: boolean; create: boolean; update: false; delete: false } };
export type AgentItem = { id: string; kind: AgentKind; title: string; description?: string | null; notes?: string | null; due_date?: string | null; status?: string; requested_priority?: number; category?: string | null; tags?: AgentTag[]; created_at?: string };

export const agentKeyPattern = /^dcp_grok_[A-Za-z0-9_-]{43}$/;
export const agentUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  if (!input || !hasOnlyAgentFields(input, ["action", "label", "days", "taskIds", "noteIds", "tagIds", "acknowledged"])) return { error: "Agent 授權資料不正確。" } as const;
  const label = typeof input.label === "string" ? input.label.trim() : "Grok Bot";
  const taskIds = ids(input.taskIds, 100), noteIds = ids(input.noteIds, 100), tagIds = ids(input.tagIds, 20);
  if (!label || Array.from(label).length > 50 || ![1, 7, 30, 90].includes(Number(input.days)) || typeof input.days !== "number") return { error: "請填寫連接名稱及有效期。" } as const;
  if (!taskIds || !noteIds || !tagIds?.length) return { error: "請選最少一個可用於新增 Task 的 Tag；每類最多開放 100 項資料。" } as const;
  if (input.acknowledged !== true) return { error: "請先確認你同意 Grok 讀取選定內容及新增 Task／Notes。" } as const;
  return { data: { label, days: input.days as number, taskIds, noteIds, tagIds } } as const;
}

export function validateAgentCreate(value: unknown) {
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
  if (dueDate !== null && (typeof dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(`${dueDate}T00:00:00Z`)) || new Date(`${dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== dueDate)) return { error: "完成日期不正確；沒有期限可留空。" } as const;
  const priority = input.priority ?? 3, tagIds = ids(input.tagIds, 20);
  if (![1, 3, 5].includes(priority as number) || typeof priority !== "number" || !tagIds?.length) return { error: "請選 Priority 及最少一個已授權 Tag。" } as const;
  return { action: "create_task", payload: { request_id: input.requestId, title, description, due_date: dueDate, priority, tag_ids: tagIds } } as const;
}
