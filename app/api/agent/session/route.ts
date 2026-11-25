import { NextRequest, NextResponse } from "next/server";
import { agentKeyPattern, agentSessionMaxAge, hasOnlyAgentFields } from "@/lib/agent-access";
import { clearSession } from "@/lib/server/auth-cookies";
import { agentCookie } from "@/lib/server/agent-key";
import { agentJson, agentOriginAllowed, readAgentBody, runAgentOperation } from "@/lib/server/agent-request";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!agentOriginAllowed(request, true)) return agentJson({ error: "請由 Agent 登入頁開始。" }, 403);
  const body = await readAgentBody(request, 2048); if (body instanceof Response) return body;
  if (!hasOnlyAgentFields(body, ["key"]) || typeof body.key !== "string" || !agentKeyPattern.test(body.key)) return agentJson({ error: "Access Code 格式不正確。" }, 422);
  const result = await runAgentOperation(request, "status", {}, body.key); if (result instanceof Response) return result;
  const maxAge = agentSessionMaxAge(result.expiresAt);
  if (maxAge === null) return agentJson({ error: "Bot Code 已到期。" }, 401);
  // A shared Grok computer must not retain a privileged human session beside
  // this restricted session. This clears local cookies, not other devices.
  const response = clearSession(NextResponse.json(result, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } }));
  response.cookies.set(agentCookie, body.key, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api/agent", maxAge });
  return response;
}
export async function DELETE(request: NextRequest) {
  if (!agentOriginAllowed(request, true)) return agentJson({ error: "來源驗證失敗。" }, 403);
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(agentCookie, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api/agent", maxAge: 0 });
  return response;
}
