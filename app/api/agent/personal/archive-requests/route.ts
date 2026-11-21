import { NextRequest } from "next/server";
import { agentObject, agentUuidPattern, hasOnlyAgentFields } from "@/lib/agent-access";
import { agentJson, agentOriginAllowed, readAgentBody } from "@/lib/server/agent-request";
import { grokPersonalService, grokPersonalTokenHash } from "@/lib/server/grok-personal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const archiveDatasets = new Set(["tasks", "notes", "family", "school", "finance_transactions"]);

export async function POST(request: NextRequest) {
  if (!agentOriginAllowed(request)) return agentJson({ error: "來源驗證失敗。" }, 403);
  if (request.nextUrl.search) return agentJson({ error: "此操作不接受查詢參數。" }, 400);
  // Only the dedicated token works here. Browser sessions, legacy codes and URL keys do not.
  const hash = grokPersonalTokenHash(request);
  if (!hash) return agentJson({ error: "請使用本人資料 Access Code。" }, 401);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return agentJson({ error: "請用 JSON 提交資料。" }, 415);
  }
  const body = await readAgentBody(request, 1024);
  if (body instanceof Response) return body;
  if (!hasOnlyAgentFields(body, ["dataset", "recordId"]) ||
    typeof body.dataset !== "string" || !archiveDatasets.has(body.dataset) ||
    typeof body.recordId !== "string" || !agentUuidPattern.test(body.recordId)) {
    return agentJson({ error: "只可為一筆支援的紀錄準備封存草稿。" }, 422);
  }
  try {
    const result = await grokPersonalService().rpc("grok_personal_request_archive", {
      p_token_hash: hash, p_dataset: body.dataset, p_record_id: body.recordId,
    });
    if (result.error) throw new Error("Grok personal archive draft failed");
    if (result.data === null) return agentJson({ error: "連接不適用，或紀錄未開放封存。" }, 404);
    const proposal = agentObject(result.data);
    if (proposal?.status === "quota") return agentJson({ error: "封存草稿已達上限，請稍後再試或先在日序處理。" }, 429);
    if (proposal?.status !== "pending" || typeof proposal.requestId !== "string" || !agentUuidPattern.test(proposal.requestId)) {
      throw new Error("Grok personal archive draft response invalid");
    }
    return agentJson({
      requestId: proposal.requestId, status: "pending", archived: false,
      reviewPath: "/settings#grok-personal-access",
      message: "只已準備草稿，未刪除或封存。必須由 Derek 親自登入日序核對並確認。",
    }, 202);
  } catch {
    return agentJson({ error: "未能安全準備封存草稿，請稍後再試。" }, 503);
  }
}
