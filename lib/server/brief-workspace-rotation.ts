import { agentUuidPattern, hasOnlyAgentFields } from "../agent-access.ts";

const methods = new Set(["oauth", "password", "otp", "totp", "webauthn", "sso/saml"]);
const timestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
export const briefWorkspaceLabel = "Grok Bot（本人工作）";
export function briefRotationOwner(user: { email?: string; email_confirmed_at?: string; is_anonymous?: boolean }) {
  return user.email?.toLowerCase() === "derekcy0309@gmail.com" && Boolean(user.email_confirmed_at) && user.is_anonymous !== true;
}

export function parseBriefRotation(body: Record<string, unknown>) {
  if (body.action !== "rotate_brief_workspace" || body.acknowledged !== true ||
      !hasOnlyAgentFields(body, ["action", "id", "expectedExpiresAt", "acknowledged"]) ||
      typeof body.id !== "string" || !agentUuidPattern.test(body.id) ||
      typeof body.expectedExpiresAt !== "string" || !timestamp.test(body.expectedExpiresAt) ||
      !Number.isFinite(Date.parse(body.expectedExpiresAt))) return null;
  // Keep the actual PostgreSQL revision; truncating microseconds lets two tabs disagree.
  return { id: body.id, expectedExpiresAt: body.expectedExpiresAt };
}

// Called only after Supabase Auth verifies the same JWT. Its iat/refresh time is not proof of a fresh human login.
export function recentRotationSession(verifiedToken: string, ownerId: string, now = Math.floor(Date.now()/1000)) {
  try {
    const claim = JSON.parse(Buffer.from(verifiedToken.split(".")[1], "base64url").toString("utf8"));
    if (claim.sub !== ownerId || claim.role !== "authenticated" || claim.is_anonymous === true ||
        typeof claim.session_id !== "string" || !agentUuidPattern.test(claim.session_id) || !Array.isArray(claim.amr)) return null;
    return claim.amr.some((entry: unknown) => {
      if (!entry || typeof entry !== "object") return false;
      const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
      return typeof method === "string" && methods.has(method) && typeof timestamp === "number" &&
        Number.isSafeInteger(timestamp) && timestamp >= now - 600 && timestamp <= now + 10;
    }) ? claim.session_id as string : null;
  } catch { return null; }
}
