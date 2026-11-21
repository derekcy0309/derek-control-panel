import type { NextRequest } from "next/server";
import { agentUuidPattern, hasOnlyAgentFields } from "@/lib/agent-access";
import { agentJson, agentOriginAllowed, readAgentBody } from "@/lib/server/agent-request";
import { accessCookie } from "@/lib/server/auth-cookies";
import { createGrokPersonalToken, grokPersonalService, hashGrokPersonalToken } from "@/lib/server/grok-personal-auth";
import { authenticateRequest } from "@/lib/server/request-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ownerEmail = "derekcy0309@gmail.com";
const recentMethods = new Set(["oauth", "password", "otp", "totp", "webauthn", "sso/saml"]);

async function verifyHuman(request: NextRequest) {
  // Do not accept public Agent/Bearer credentials on these owner-only routes.
  if (request.headers.has("authorization") || !request.cookies.get(accessCookie)?.value) {
    return agentJson({ error: "請先用本人 Dayline 帳戶登入。", reauth: true }, 401);
  }
  const context = await authenticateRequest(request);
  if (context instanceof Response) {
    return context.status === 401
      ? agentJson({ error: "登入已失效，請先用本人 Dayline 帳戶重新登入。", reauth: true }, 401)
      : context;
  }
  if (context.user.is_anonymous || !context.user.email_confirmed_at || context.user.email?.toLowerCase() !== ownerEmail) {
    return agentJson({ error: "只限本人管理呢個 Grok 連接。" }, 403);
  }
  const profile = await context.client.from("user_profiles").select("active,is_admin").eq("user_id", context.user.id).maybeSingle();
  if (profile.error) return failed();
  return profile.data?.active === true && profile.data.is_admin === true
    ? context
    : agentJson({ error: "只限啟用中的本人管理員帳戶使用。" }, 403);
}

function recentSession(verifiedToken: string, actor: string): string | null {
  // Called only after authenticateRequest validated this same token with
  // Supabase Auth. Read AMR, not JWT iat: refreshing a JWT is not re-login.
  // The mutating RPC also checks that session_id still belongs to this owner.
  try {
    const claims = JSON.parse(Buffer.from(verifiedToken.split(".")[1], "base64url").toString("utf8"));
    if (claims.sub !== actor || claims.role !== "authenticated" || claims.is_anonymous === true
      || typeof claims.session_id !== "string" || !agentUuidPattern.test(claims.session_id)
      || !Array.isArray(claims.amr)) return null;
    const now = Math.floor(Date.now() / 1000);
    return claims.amr.some((entry: unknown) => {
      if (!entry || typeof entry !== "object") return false;
      const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
      return typeof method === "string" && recentMethods.has(method) && typeof timestamp === "number"
        && Number.isSafeInteger(timestamp) && timestamp >= now - 600 && timestamp <= now + 10;
    }) ? claims.session_id : null;
  } catch {
    return null;
  }
}

function failed(error?: { code?: string } | null) {
  if (error?.code === "PGRST202" || error?.code === "PGRST205") {
    return agentJson({ error: "Grok 本人資料存取尚未啟用，未有改動任何資料。" }, 503);
  }
  return agentJson({ error: "未能安全完成操作，請重新載入核對狀態。" }, 503);
}

function reauthenticate() {
  return agentJson({ error: "請先用 Google 重新登入本人帳戶，再返嚟確認。", reauth: true }, 401);
}

function connectionFields(data: { connected: boolean; expiresAt?: unknown }) {
  return { connected: data.connected, expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : null };
}

export async function GET(request: NextRequest) {
  if (!agentOriginAllowed(request) || request.nextUrl.search) {
    return agentJson({ error: "請由本人 Dayline 設定讀取。" }, 403);
  }
  const context = await verifyHuman(request);
  if (context instanceof Response) return context;
  try {
    const owner = context.user.id;
    const service = grokPersonalService();
    const [connection, reviews] = await Promise.all([
      service.rpc("grok_personal_connection", { p_owner_id: owner, p_action: "status", p_token_hash: null, p_session_id: null }),
      service.rpc("grok_personal_archives", { p_owner_id: owner })
    ]);
    if (connection.error || reviews.error) return failed(connection.error ?? reviews.error);
    if (typeof connection.data?.connected !== "boolean" || !Array.isArray(reviews.data)) return failed();
    const pending = reviews.data.map(({ id, dataset, recordId, label, status, createdAt }) => ({ id, dataset, recordId, label, status, createdAt }));
    return agentJson({ ...connectionFields(connection.data), pending });
  } catch {
    return failed();
  }
}

export async function POST(request: NextRequest) {
  if (!agentOriginAllowed(request, true) || request.nextUrl.search) {
    return agentJson({ error: "請喺本人 Dayline 設定操作。" }, 403);
  }
  const context = await verifyHuman(request);
  if (context instanceof Response) return context;
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return agentJson({ error: "請用 JSON 提交確認。" }, 415);
  }
  const data = await readAgentBody(request, 768);
  if (data instanceof Response) return data;
  const { action, requestId } = data;
  switch (action) {
    case "rotate":
      if (!hasOnlyAgentFields(data, ["action", "consent"]) || data.consent !== true) {
        return agentJson({ error: "請確認同意存取範圍，先可以建立新 Code。" }, 422);
      }
      break;
    case "revoke":
      if (!hasOnlyAgentFields(data, ["action"])) return agentJson({ error: "停用操作不正確。" }, 422);
      break;
    case "confirm":
    case "dismiss":
      if (typeof requestId !== "string" || !agentUuidPattern.test(requestId) ||
        (action === "confirm"
          ? !hasOnlyAgentFields(data, ["action", "requestId", "ownerOrdered", "confirmation"])
            || data.ownerOrdered !== true || data.confirmation !== "archive"
          : !hasOnlyAgentFields(data, ["action", "requestId"]))) {
        return agentJson({ error: "未有收到有效的本人指示及確認，記錄冇改過。" }, 422);
      }
      break;
    default:
      return agentJson({ error: "不支援此操作。" }, 422);
  }
  const mustBeRecent = action === "rotate" || action === "confirm";
  const sessionId = mustBeRecent ? recentSession(context.token, context.user.id) : null;
  if (mustBeRecent && !sessionId) return reauthenticate();

  try {
    if (action === "rotate" || action === "revoke") {
      const accessCode = action === "rotate" ? createGrokPersonalToken() : null;
      const connection = await grokPersonalService().rpc("grok_personal_connection", {
        p_owner_id: context.user.id, p_action: action, p_token_hash: accessCode ? hashGrokPersonalToken(accessCode) : null,
        p_session_id: sessionId
      });
      if (connection.error) return failed(connection.error);
      if (connection.data?.status === "reauth") return reauthenticate();
      if (connection.data?.connected !== (action === "rotate")) return failed();
      const response = connectionFields(connection.data);
      // The plaintext never enters Supabase, logs, browser storage or a URL.
      return accessCode ? agentJson({ ...response, accessCode }, 201) : agentJson(response);
    }

    // Use the original authenticated client so the RPC and row triggers see
    // auth.uid(), and independently verify the actual human session/AMR.
    const result = await context.client.rpc("grok_personal_decide_archive", {
      p_owner_id: context.user.id, p_request_id: requestId, p_decision: action, p_session_id: sessionId,
      p_owner_ordered: action === "confirm", p_confirmation: action === "confirm" ? "archive" : null
    });
    if (result.error) return failed(result.error);
    const status = result.data?.status;
    if (status === "reauth") return reauthenticate();
    if (["conflict", "disabled", "expired"].includes(status)) {
      return agentJson({ error: "記錄或連接已改變，未有封存。請重新載入核對。", status }, 409);
    }
    if (status === "invalid") return agentJson({ error: "未有有效的本人指示及確認，記錄冇改過。" }, 422);
    if (status === "missing" || result.data === null) {
      return agentJson({ error: "搵唔到有效建議，未有封存。請重新載入核對。" }, 404);
    }
    if (status === (action === "confirm" ? "archived" : "dismissed")) return agentJson({ status });
    if (status === "archived" || status === "dismissed") {
      return agentJson({ error: "呢項建議已經處理，冇再改動記錄。", status }, 409);
    }
    return failed();
  } catch {
    return failed();
  }
}
