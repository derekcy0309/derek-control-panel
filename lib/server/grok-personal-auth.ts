import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { agentObject, agentUuidPattern } from "../agent-access.ts";

const bearerPattern = /^Bearer (dcp_trusted_[A-Za-z0-9_-]{43})$/i;
export type GrokPersonalOwner = { ownerId: string; connectionId: string };

export function createGrokPersonalToken() {
  return `dcp_trusted_${randomBytes(32).toString("base64url")}`;
}

export function hashGrokPersonalToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function grokPersonalTokenHash(request: Request): string | null {
  const token = bearerPattern.exec(request.headers.get("authorization") ?? "")?.[1];
  return token?.startsWith("dcp_trusted_") ? hashGrokPersonalToken(token) : null;
}

export function grokPersonalService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Grok personal data unavailable");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function grokPersonalOwner(request: Request): Promise<GrokPersonalOwner | null> {
  const hash = grokPersonalTokenHash(request);
  if (!hash) return null;
  const result = await grokPersonalService().rpc("grok_personal_owner", { p_token_hash: hash });
  if (result.error) throw new Error("Grok personal connection check failed");
  if (result.data === null) return null;
  const grant = agentObject(result.data);
  if (typeof grant?.ownerId !== "string" || !agentUuidPattern.test(grant.ownerId) ||
    typeof grant.connectionId !== "string" || !agentUuidPattern.test(grant.connectionId)) {
    throw new Error("Grok personal connection response invalid");
  }
  return { ownerId: grant.ownerId, connectionId: grant.connectionId };
}
