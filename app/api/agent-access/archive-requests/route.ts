import type { NextRequest } from "next/server";
import { agentObject, agentUuidPattern, hasOnlyAgentFields } from "@/lib/agent-access";
import { accessCookie } from "@/lib/server/auth-cookies";
import { agentJson, agentOriginAllowed, readAgentBody } from "@/lib/server/agent-request";
import { authenticateRequest } from "@/lib/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const recentMethods = new Set(["oauth", "password", "otp", "totp", "webauthn", "sso/saml"]);
const reauthenticate = () => agentJson({
  error: "請用本人 Dayline 帳戶重新登入，再返嚟確認。", reauth: true
}, 401);
const failed = () => agentJson({ error: "暫時未能安全處理 Agent 封存請求，請重新載入核對。" }, 503);

async function verifyHuman(request: NextRequest) {
  // Never accept a public Agent key, arbitrary bearer or the Agent-only cookie.
  if (request.headers.has("authorization") || !request.cookies.get(accessCookie)?.value) return reauthenticate();
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context.status === 401 ? reauthenticate() : context;
  if (context.user.is_anonymous || !context.user.email_confirmed_at) {
    return agentJson({ error: "只限已驗證嘅本人 Dayline 帳戶操作。" }, 403);
  }
  const profile = await context.client.from("user_profiles")
    .select("active,is_admin").eq("user_id", context.user.id).maybeSingle();
  if (profile.error) return failed();
  if (profile.data?.active !== true || profile.data?.is_admin !== true) {
    return agentJson({ error: "只限啟用中嘅本人管理員帳戶操作。" }, 403);
  }
  return context;
}

function recentSession(verifiedToken: string, actor: string): string | null {
  // authenticateRequest has verified this same token. AMR, not the reissued
  // access token's iat, indicates a real re-login. SQL rechecks the native session.
  try {
    const claims = agentObject(JSON.parse(Buffer.from(verifiedToken.split(".")[1], "base64url").toString("utf8")));
    if (!claims || claims.sub !== actor || claims.role !== "authenticated" || claims.is_anonymous === true
      || typeof claims.session_id !== "string" || !agentUuidPattern.test(claims.session_id)
      || !Array.isArray(claims.amr)) return null;
    const now = Math.floor(Date.now() / 1000);
    return claims.amr.some((entry: unknown) => {
      const amr = agentObject(entry);
      return typeof amr?.method === "string" && recentMethods.has(amr.method)
        && typeof amr.timestamp === "number" && Number.isSafeInteger(amr.timestamp)
        && amr.timestamp >= now - 600 && amr.timestamp <= now + 10;
    }) ? claims.session_id : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  if (!agentOriginAllowed(request) || request.nextUrl.search) {
    return agentJson({ error: "請喺本人 Dayline 設定讀取封存請求。" }, 403);
  }
  try {
    const context = await verifyHuman(request);
    if (context instanceof Response) return context;
    const result = await context.client.rpc("owner_workspace_archive_reviews");
    if (result.error || !Array.isArray(result.data)) return failed();
    const requests = result.data.flatMap((entry: unknown) => {
      const row = agentObject(entry);
      if (!row || typeof row.id !== "string" || !agentUuidPattern.test(row.id)
        || (row.kind !== "task" && row.kind !== "note") || typeof row.label !== "string"
        || typeof row.createdAt !== "string" || typeof row.grantLabel !== "string") return [];
      return [{ id: row.id, kind: row.kind, label: row.label, createdAt: row.createdAt, grantLabel: row.grantLabel }];
    });
    return agentJson({ requests });
  } catch {
    return failed();
  }
}

export async function POST(request: NextRequest) {
  if (!agentOriginAllowed(request, true) || request.nextUrl.search) {
    return agentJson({ error: "請喺本人 Dayline 設定確認封存。" }, 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return agentJson({ error: "請用 JSON 提交確認。" }, 415);
  }
  try {
    const context = await verifyHuman(request);
    if (context instanceof Response) return context;
    const body = await readAgentBody(request, 768);
    if (body instanceof Response) return body;
    const { id, decision, ownerOrdered, confirmation } = body;
    const confirming = decision === "confirm";
    if (typeof id !== "string" || !agentUuidPattern.test(id)
      || (confirming
        ? !hasOnlyAgentFields(body, ["id", "decision", "ownerOrdered", "confirmation"])
          || ownerOrdered !== true || confirmation !== "archive"
        : decision !== "dismiss" || !hasOnlyAgentFields(body, ["id", "decision"]))) {
      return agentJson({ error: "未收到有效嘅本人指示同確認；未有封存。" }, 422);
    }
    const session = confirming ? recentSession(context.token, context.user.id) : null;
    if (confirming && !session) return reauthenticate();
    // Original verified human JWT, not service_role or an agent token.
    const result = await context.client.rpc("decide_owner_workspace_archive", {
      p_request_id: id, p_decision: decision, p_session_id: session,
      p_owner_ordered: confirming, p_confirmation: confirming ? "archive" : null
    });
    if (result.error) return failed();
    const status = agentObject(result.data)?.status;
    if (status === "reauth") return reauthenticate();
    if (status === (confirming ? "archived" : "dismissed")) return agentJson({ status });
    if (status === "conflict" || status === "disabled" || status === "expired") {
      return agentJson({ error: "記錄或 Agent 授權已改變；未有封存，請重新載入。", status }, 409);
    }
    if (status === "archived" || status === "dismissed") {
      return agentJson({ error: "呢項請求已經處理，冇再改動記錄。", status }, 409);
    }
    if (status === "invalid") return agentJson({ error: "未收到有效嘅本人確認；未有封存。" }, 422);
    if (status === "missing" || result.data === null) {
      return agentJson({ error: "搵唔到有效嘅封存請求。" }, 404);
    }
    return failed();
  } catch {
    return failed();
  }
}
