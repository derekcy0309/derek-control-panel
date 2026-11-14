import { createHash, randomBytes } from "node:crypto";
import { agentKeyPattern } from "../agent-access.ts";

export const agentCookie = "dcp_agent";
export function newAgentKey() {
  const key = "dcp_grok_" + randomBytes(32).toString("base64url");
  return { key, hash: hashAgentKey(key)!, fingerprint: hashAgentKey(key)!.slice(0, 12) };
}
export function hashAgentKey(value: unknown): string | null {
  return typeof value === "string" && agentKeyPattern.test(value) ? createHash("sha256").update(value).digest("hex") : null;
}
