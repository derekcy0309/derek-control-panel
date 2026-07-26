import { NextRequest } from "next/server";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const result = await context.client.rpc("household_context");
  if (result.error) return privateJson({ error: result.error.message }, 500);
  return privateJson({ household: result.data ?? null });
}

export async function POST(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const body = await request.json().catch(() => null) as {
    action?: unknown;
    email?: unknown;
    householdId?: unknown;
    accept?: unknown;
  } | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (action === "invite") {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return privateJson({ error: "請輸入另一位用戶完整登入電郵。" }, 422);
    }
    const result = await context.client.rpc("invite_household_member", { target_email: email });
    if (result.error) return privateJson({ error: friendlyHouseholdError(result.error.message) }, 409);
    const household = await context.client.rpc("household_context");
    return privateJson({ householdId: result.data, household: household.data ?? null }, 201);
  }
  if (action === "respond") {
    const householdId = typeof body?.householdId === "string" ? body.householdId : "";
    if (!/^[0-9a-f-]{36}$/i.test(householdId)) {
      return privateJson({ error: "家庭邀請識別碼不正確。" }, 422);
    }
    if (typeof body?.accept !== "boolean") {
      return privateJson({ error: "請明確選擇接受或拒絕家庭邀請。" }, 422);
    }
    const result = await context.client.rpc("respond_household_invitation", {
      p_household_id: householdId,
      p_accept: body.accept
    });
    if (result.error) return privateJson({ error: friendlyHouseholdError(result.error.message) }, 409);
    const household = await context.client.rpc("household_context");
    return privateJson({ accepted: Boolean(result.data), household: household.data ?? null });
  }
  return privateJson({ error: "不支援的家庭操作。" }, 400);
}

function friendlyHouseholdError(message: string) {
  if (message.includes("HOUSEHOLD_TARGET_NOT_FOUND")) return "找不到呢個已啟用登入帳戶。";
  if (message.includes("HOUSEHOLD_TARGET_ALREADY_LINKED")) return "對方已連結另一個家庭。";
  if (message.includes("HOUSEHOLD_INVITATION_NOT_FOUND")) return "家庭邀請已處理或不存在。";
  if (message.includes("HOUSEHOLD_OWNER_REQUIRED")) return "只有家庭共享建立者可以邀請另一位用戶。";
  if (message.includes("HOUSEHOLD_ALREADY_FULL")) return "目前家庭共享已經連結兩位用戶。";
  return message;
}
