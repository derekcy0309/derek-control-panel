import { NextRequest } from "next/server";
import { agentUuidPattern, hasOnlyAgentFields, validateAgentGrant } from "@/lib/agent-access";
import { authenticateRequest } from "@/lib/server/request-context";
import { readMyTaskTags } from "@/lib/server/task-tags";
import { newAgentKey } from "@/lib/server/agent-key";
import { agentDatabaseError, agentJson, agentOriginAllowed, readAgentBody } from "@/lib/server/agent-request";
export const dynamic = "force-dynamic";

async function admin(request: NextRequest) {
  const context = await authenticateRequest(request); if (context instanceof Response) return context;
  const profile = await context.client.from("user_profiles").select("is_admin,active").eq("user_id", context.user.id).maybeSingle();
  if (profile.error) return agentJson({ error: "未能核對管理員權限。" }, 503);
  return profile.data?.is_admin && profile.data.active ? context : agentJson({ error: "只有啟用中的管理員可管理自己的 Agent 存取。" }, 403);
}
export async function GET(request: NextRequest) {
  const context = await admin(request); if (context instanceof Response) return context;
  const [grants, events, tasks, notes, tags] = await Promise.all([
    context.client.from("agent_access_grants").select("id,label,key_fingerprint,created_at,expires_at,revoked_at,last_used_at").eq("owner_id", context.user.id).order("created_at", { ascending: false }).limit(30),
    context.client.from("agent_access_events").select("id,grant_id,action,resource_type,resource_id,created_at").eq("owner_id", context.user.id).order("created_at", { ascending: false }).limit(20),
    context.client.from("tasks").select("id,title").eq("owner_id", context.user.id).is("deleted_at", null).is("archived_at", null).order("updated_at", { ascending: false }).limit(100),
    context.client.from("operating_items").select("id,title").eq("owner_id", context.user.id).eq("item_type", "note").is("archived_at", null).order("updated_at", { ascending: false }).limit(100),
    readMyTaskTags(context.client, context.user)
  ]);
  const error = [grants, events, tasks, notes, tags].find((result) => result.error)?.error;
  if (error) return agentDatabaseError(error);
  return agentJson({ grants: grants.data ?? [], events: events.data ?? [], tasks: tasks.data ?? [], notes: notes.data ?? [], tags: tags.tags });
}
export async function POST(request: NextRequest) {
  if (!agentOriginAllowed(request, true)) return agentJson({ error: "請由設定頁管理 Agent。" }, 403);
  const context = await admin(request); if (context instanceof Response) return context;
  const body = await readAgentBody(request); if (body instanceof Response) return body;
  if (body.action === "revoke") {
    if (!hasOnlyAgentFields(body, ["action", "id"]) || typeof body.id !== "string" || !agentUuidPattern.test(body.id)) return agentJson({ error: "Agent 識別碼不正確。" }, 422);
    const result = await context.client.rpc("revoke_my_agent_access", { p_grant_id: body.id });
    return result.error ? agentDatabaseError(result.error) : agentJson({ ok: true });
  }
  if (body.action !== "create") return agentJson({ error: "不支援此管理操作。" }, 400);
  const valid = validateAgentGrant(body); if ("error" in valid) return agentJson({ error: valid.error }, 422);
  const credential = newAgentKey();
  const result = await context.client.rpc("create_my_agent_access", {
    p_token_hash: credential.hash, p_label: valid.data.label, p_days: valid.data.days,
    p_task_ids: valid.data.taskIds, p_note_ids: valid.data.noteIds, p_tag_ids: valid.data.tagIds
  });
  if (result.error) return agentDatabaseError(result.error);
  // Returned once, only to the authenticated admin. Never logged/persisted raw.
  return agentJson({ grant: result.data, accessCode: credential.key, loginPath: "/agent" }, 201);
}
