import { NextRequest } from "next/server";
import { agentUuidPattern, validateAgentCreate } from "@/lib/agent-access";
import { agentJson, readAgentBody, runAgentOperation } from "@/lib/server/agent-request";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if ([...params.keys()].some((key) => !["view", "kind", "id", "offset"].includes(key))) return agentJson({ error: "不支援此 Agent 查詢；請勿把 Access Code 放在網址。" }, 400);
  const view = params.get("view") ?? "status";
  if (!["status", "list", "detail"].includes(view)) return agentJson({ error: "不支援此 Agent 操作。" }, 403);
  const kind = params.get("kind") ?? "task", id = params.get("id");
  const rawOffset = params.get("offset") ?? "0", offset = Number(rawOffset);
  if (!["task", "note"].includes(kind) || !/^\d+$/.test(rawOffset) || !Number.isSafeInteger(offset) || offset > 10000 || (view === "detail" && (!id || !agentUuidPattern.test(id)))) return agentJson({ error: "查詢資料不正確。" }, 422);
  const result = await runAgentOperation(request, view, view === "status" ? {} : { kind, offset, ...(id ? { id } : {}) });
  return result instanceof Response ? result : agentJson(result);
}
export async function POST(request: NextRequest) {
  const body = await readAgentBody(request); if (body instanceof Response) return body;
  const valid = validateAgentCreate(body); if ("error" in valid) return agentJson({ error: valid.error }, 422);
  const result = await runAgentOperation(request, valid.action, valid.payload);
  return result instanceof Response ? result : agentJson(result, 201);
}
function forbidden() { return agentJson({ error: "Agent 不可修改、完成、轉交、封存或刪除現有資料。" }, 403); }
export const DELETE = forbidden;
export const PUT = forbidden;
export const PATCH = forbidden;
