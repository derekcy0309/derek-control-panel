import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { agentObject } from "@/lib/agent-access";
import { agentCookie, hashAgentKey } from "@/lib/server/agent-key";

export function agentJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}
export function agentOriginAllowed(request: NextRequest, required = false) {
  const origin = request.headers.get("origin");
  return origin ? origin === request.nextUrl.origin : !required;
}
export async function readAgentBody(request: NextRequest, maxBytes = 32768): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return agentJson({ error: "請用 JSON 提交資料。" }, 415);
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes || !request.body) return agentJson({ error: "提交資料過大或不完整。" }, 413);
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return agentJson({ error: "提交資料過大。" }, 413); }
      chunks.push(part.value);
    }
    const body = agentObject(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return body ?? agentJson({ error: "提交格式不正確。" }, 400);
  } catch { return agentJson({ error: "提交格式不正確。" }, 400); }
}
export async function runAgentOperation(request: NextRequest, action: string, payload: Record<string, unknown> = {}, suppliedKey?: unknown) {
  if (!agentOriginAllowed(request)) return agentJson({ error: "來源驗證失敗。" }, 403);
  // A user JWT/session is intentionally NEVER accepted as an agent credential.
  const authorization = request.headers.get("authorization") ?? "";
  const key = suppliedKey ?? (authorization.startsWith("Bearer ") ? authorization.slice(7) : request.cookies.get(agentCookie)?.value);
  const hash = hashAgentKey(key);
  if (!hash) return agentJson({ error: "Agent 登入已失效或 Access Code 不正確。" }, 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return agentJson({ error: "Agent 存取尚未設定；請聯絡管理員。" }, 503);
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    // The service credential stays here. The only operation it performs is this
    // audited, owner/resource-scoped, allowlisted database RPC. No arbitrary CRUD.
    const result = await client.rpc("agent_access_operation", { p_token_hash: hash, p_action: action, p_payload: payload });
    if (result.error) return agentDatabaseError(result.error);
    return result.data as Record<string, unknown>;
  } catch {
    console.error("agent_access_transport_failed"); // No tokens, user content or error objects.
    return agentJson({ error: "連線未完成，請重試；新增時請沿用同一識別碼。" }, 503);
  }
}
export function agentDatabaseError(error: { code?: string; message?: string }) {
  const message = error.message ?? "";
  if (message.includes("SCHOOL_ONLY")) return agentJson({ error: "呢個 Code 只限子女及學校，未開放 Task、Notes 或 Calendar。" }, 403);
  if (message.includes("AGENT_UNAUTHORIZED")) return agentJson({ error: "Agent 存取已到期、已停用或 Access Code 不正確。" }, 401);
  if (message.includes("AGENT_NOT_FOUND")) return agentJson({ error: "此項目未開放、已封存或不存在。" }, 404);
  if (message.includes("AGENT_RATE_LIMIT")) return agentJson({ error: "Agent 操作太密，請稍後再試；每日最多新增 50 項。" }, 429);
  if (message.includes("AGENT_REQUEST_CONFLICT")) return agentJson({ error: "此新增識別碼已用於另一份內容，未有重複新增。" }, 409);
  if (message.includes("AGENT_INVALID") || message.includes("AGENT_TAG")) return agentJson({ error: "資料未通過驗證；請檢查名稱、日期及已授權 Tags。" }, 422);
  if (message.includes("AGENT_FORBIDDEN") || message.includes("AGENT_ADMIN_REQUIRED")) return agentJson({ error: "Agent 只可讀取及新增，無權修改或刪除。" }, 403);
  if (error.code === "PGRST202" || error.code === "PGRST205") return agentJson({ error: "Agent migration 尚未套用，功能未啟用。" }, 503);
  console.error("agent_access_database_failed", { code: error.code ?? "unknown" });
  return agentJson({ error: "未能安全完成操作，請稍後重試。" }, 500);
}
