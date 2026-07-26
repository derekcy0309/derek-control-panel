import { NextRequest } from "next/server";
import { syncConfirmedSchedule } from "@/lib/integrations/google-calendar";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const body = await request.json().catch(() => null) as { itemId?: unknown } | null;
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return privateJson({ error: "行程識別碼不正確。" }, 422);
  const item = await context.client.from("operating_items")
    .select("id,title,description,area,owner_id,schedule_start_at,schedule_end_at,schedule_timezone,schedule_status,calendar_target,sensitive")
    .eq("id", itemId)
    .eq("owner_id", context.user.id)
    .maybeSingle();
  if (item.error) return privateJson({ error: item.error.message }, 500);
  if (!item.data) return privateJson({ error: "找不到行程或你不是擁有人。" }, 404);
  try {
    const result = await syncConfirmedSchedule(context.client, context.user.id, item.data);
    return privateJson(result);
  } catch (error) {
    return privateJson({ error: error instanceof Error ? error.message : "未能同步 Calendar。" }, 502);
  }
}
