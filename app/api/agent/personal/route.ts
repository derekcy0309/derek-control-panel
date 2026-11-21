import { NextRequest } from "next/server";
import { agentJson } from "@/lib/server/agent-request";
import { readAppleCalendarMonth } from "@/lib/server/apple-calendar-month";
import { grokPersonalOwner, grokPersonalService } from "@/lib/server/grok-personal-auth";
import { grokPersonalReadCatalog, grokPersonalReadQuery, projectGrokPersonalCalendar, readGrokPersonalRows } from "@/lib/server/grok-personal-read";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const invalidToken = () => agentJson({ error: "Grok 存取未啟用、已停用或 Access Code 不正確。" }, 401);

export async function GET(request: NextRequest) {
  const input = grokPersonalReadQuery(request.nextUrl.searchParams);
  if (!input) return agentJson({ error: "請檢查資料類別、月份同分頁。唔可以指定帳戶、私有連結或任意日期範圍。" }, 400);
  try {
    const owner = await grokPersonalOwner(request);
    if (!owner) return invalidToken();
    if (input.dataset === "catalog") return agentJson({ datasets: grokPersonalReadCatalog, defaultLimit: 15, maxLimit: 30, timezone: "Asia/Hong_Kong" });
    const service = grokPersonalService();
    const result = input.dataset === "icloud"
      ? projectGrokPersonalCalendar(await readAppleCalendarMonth(owner.ownerId, input.window, service), input.window)
      : await readGrokPersonalRows(service, owner.ownerId, input);
    // A credential revoked or rotated while waiting for iCloud/Postgres
    // must not still send account data on the old authorization.
    const current = await grokPersonalOwner(request);
    if (current?.connectionId !== owner.connectionId || current.ownerId !== owner.ownerId) return invalidToken();
    return agentJson(result);
  } catch {
    // Raw provider/DB errors may embed sensitive input or integration secrets.
    console.error("grok_personal_read_failed");
    return agentJson({ error: "暫時讀取唔到本人資料，請稍後重試。" }, 503);
  }
}
