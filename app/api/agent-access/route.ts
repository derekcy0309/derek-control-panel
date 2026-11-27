import { NextRequest } from "next/server";
import { agentUuidPattern, hasOnlyAgentFields, validateAgentGrant } from "@/lib/agent-access";
import { authenticateRequest } from "@/lib/server/request-context";
import { readMyTaskTags } from "@/lib/server/task-tags";
import { newAgentKey } from "@/lib/server/agent-key";
import { agentDatabaseError, agentJson, agentOriginAllowed, readAgentBody } from "@/lib/server/agent-request";
import { accessCookie } from "@/lib/server/auth-cookies";
import { grokPersonalService } from "@/lib/server/grok-personal-auth";
import { briefRotationOwner, briefWorkspaceLabel, parseBriefRotation, recentRotationSession } from "@/lib/server/brief-workspace-rotation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function admin(request: NextRequest) {
  const context = await authenticateRequest(request); if (context instanceof Response) return context;
  const profile = await context.client.from("user_profiles").select("is_admin,active").eq("user_id", context.user.id).maybeSingle();
  if (profile.error) return agentJson({ error: "未能核對管理員權限。" }, 503);
  return profile.data?.is_admin && profile.data.active ? context : agentJson({ error: "只有啟用中的管理員可管理自己的 Agent 存取。" }, 403);
}
export async function GET(request: NextRequest) {
  const context = await admin(request); if (context instanceof Response) return context;
  const [grants, events, tasks, notes, tags] = await Promise.all([
    context.client.from("agent_access_grants").select("id,label,key_fingerprint,created_at,expires_at,revoked_at,last_used_at,owner_workspace").eq("owner_id", context.user.id).order("created_at", { ascending: false }).limit(30),
    context.client.from("agent_access_events").select("id,grant_id,action,resource_type,resource_id,created_at").eq("owner_id", context.user.id).order("created_at", { ascending: false }).limit(20),
    context.client.from("tasks").select("id,title").eq("owner_id", context.user.id).is("deleted_at", null).is("archived_at", null).order("updated_at", { ascending: false }).limit(100),
    context.client.from("operating_items").select("id,title").eq("owner_id", context.user.id).eq("item_type", "note").is("archived_at", null).order("updated_at", { ascending: false }).limit(100),
    readMyTaskTags(context.client, context.user)
  ]);
  const error = [grants, events, tasks, notes, tags].find((result) => result.error)?.error;
  if (error) return agentDatabaseError(error);
  const liveGrants = grants.data ?? [];
  const candidates = briefRotationOwner(context.user)
    ? liveGrants.filter(g => g.label === briefWorkspaceLabel && !g.revoked_at && Date.parse(g.expires_at) > Date.now())
    : [];
  const eligible = new Set<string>();
  if (candidates.length) {
    const scoped = await context.client.from("agent_brief_permissions").select("grant_id").eq("owner_id", context.user.id)
      .in("grant_id", candidates.map(g => g.id)).is("revoked_at", null);
    if (!scoped.error) for (const permission of scoped.data ?? []) eligible.add(permission.grant_id);
  }
  return agentJson({ grants: liveGrants.map(g=>({ ...g, brief_rotation_eligible: eligible.has(g.id) && eligible.size === 1 })), events: events.data ?? [], tasks: tasks.data ?? [], notes: notes.data ?? [], tags: tags.tags });
}
export async function POST(request: NextRequest) {
  if (!agentOriginAllowed(request, true)) return agentJson({ error: "請由設定頁管理 Agent。" }, 403);
  const context = await admin(request); if (context instanceof Response) return context;
  const body = await readAgentBody(request); if (body instanceof Response) return body;
  if (body.action === "rotate_brief_workspace") {
    const target = parseBriefRotation(body);
    if (!target) return agentJson({ error: "請重新載入設定，確認要更換的摘要連接。" }, 422);
    if (!request.cookies.get(accessCookie)?.value || request.headers.has("authorization") || !briefRotationOwner(context.user)) {
      return agentJson({ error: "此操作只限本人登入日序後使用。" }, 403);
    }
    const reauthenticate=()=>agentJson({ error: "請先用 Google 重新登入日序，再返回設定更換存取碼。", reauth:true }, 401);
    const session = recentRotationSession(context.token,context.user.id);
    if (!session) return reauthenticate();
    try {
      const credential = newAgentKey();
      const result = await grokPersonalService().rpc("rotate_owner_workspace_brief_code", {
        p_owner_id: context.user.id,
        p_grant_id: target.id,
        p_expected_expires_at: target.expectedExpiresAt,
        p_token_hash: credential.hash,
        p_session_id: session
      });
      const failure = result.error?.message ?? "";
      if (failure.includes("AGENT_REAUTH")) return reauthenticate();
      if (failure.includes("AGENT_ROTATE_CONFLICT")) return agentJson({ error: "摘要連接已變更。請重新載入設定；系統沒有再次更換存取碼。" }, 409);
      if (result.error) return agentDatabaseError(result.error);
      if (result.data?.id !== target.id || result.data?.owner_workspace !== true) throw new Error("Rotation result missing");
      // New plaintext exists only in this response to the verified human.
      return agentJson({ grant: result.data, accessCode: credential.key, loginPath: "/agent/brief" }, 201);
    } catch {
      return agentJson({ error: "未能確認是否已更換。請重新載入設定核對有效期；不要重複提交。" }, 503);
    }
  }
  if (body.action === "revoke") {
    if (!hasOnlyAgentFields(body, ["action", "id"]) || typeof body.id !== "string" || !agentUuidPattern.test(body.id)) return agentJson({ error: "Agent 識別碼不正確。" }, 422);
    const result = await context.client.rpc("revoke_my_agent_access", { p_grant_id: body.id });
    return result.error ? agentDatabaseError(result.error) : agentJson({ ok: true });
  }
  if (body.action !== "create") return agentJson({ error: "不支援此管理操作。" }, 400);
  const valid = validateAgentGrant(body); if ("error" in valid) return agentJson({ error: valid.error }, 422);
  if (valid.data.scope === "owner_workspace" && (!request.cookies.get("dcp_access")?.value || context.user.is_anonymous)) {
    return agentJson({ error: "請先用本人帳戶登入日序，先可以新增個人工作 Agent。" }, 403);
  }
  const credential = newAgentKey();
  const grantInput = { p_token_hash: credential.hash, p_label: valid.data.label, p_days: valid.data.days };
  const result = valid.data.scope === "owner_workspace"
    ? await context.client.rpc("create_my_owner_workspace_agent", grantInput)
    : await context.client.rpc("create_my_agent_access", {
      ...grantInput, p_task_ids: valid.data.taskIds, p_note_ids: valid.data.noteIds, p_tag_ids: valid.data.tagIds
    });
  if (result.error) return agentDatabaseError(result.error);
  // Returned once, only to the authenticated admin. Never logged/persisted raw.
  return agentJson({ grant: result.data, accessCode: credential.key, loginPath: "/agent" }, 201);
}
