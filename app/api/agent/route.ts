import { NextRequest } from "next/server";
import { agentUuidPattern, validateAgentArchiveRequest, validateAgentCreate, validateAgentUpdate } from "@/lib/agent-access";
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
  const archiveRequested = body.action === "request_archive";
  // The SQL grant rechecks tag requirements: older, selected grants still
  // require at least one of the owner's explicitly permitted Tags.
  const valid = archiveRequested ? validateAgentArchiveRequest(body) : validateAgentCreate(body, true);
  if ("error" in valid) return agentJson({ error: valid.error }, 422);
  const result = await runAgentOperation(request, valid.action, valid.payload);
  return result instanceof Response ? result : agentJson(result, archiveRequested ? 202 : 201);
}
export async function PATCH(request: NextRequest) {
  const body = await readAgentBody(request); if (body instanceof Response) return body;
  const valid = validateAgentUpdate(body); if ("error" in valid) return agentJson({ error: valid.error }, 422);
  const result = await runAgentOperation(request, valid.action, valid.payload);
  return result instanceof Response ? result : agentJson(result);
}
function forbidden() { return agentJson({ error: "Agent 不可直接刪除或取代資料。封存只可提交請求，由資料擁有人喺日序確認。" }, 403); }
export const DELETE = forbidden;
export const PUT = forbidden;
