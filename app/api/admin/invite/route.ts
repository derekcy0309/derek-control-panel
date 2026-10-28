import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return privateJson({ error: "來源驗證失敗，請由 Panel 設定頁重新嘗試。" }, 403);
  }
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const body = await request.json().catch(() => null) as { email?: unknown; displayName?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim().slice(0, 100) : "";
  if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) return privateJson({ error: "請輸入新用戶的完整電郵地址。" }, 422);

  const profile = await context.client.from("user_profiles")
    .select("is_admin,active")
    .eq("user_id", context.user.id)
    .maybeSingle();
  if (profile.error) return privateJson({ error: "未能核對管理員權限。" }, 500);
  if (!profile.data?.is_admin || !profile.data.active) return privateJson({ error: "只有啟用中的管理員可以邀請新用戶。" }, 403);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return privateJson({ error: "伺服器尚未設定新增用戶所需的 Service Role Key。" }, 503);
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const invited = await admin.auth.admin.inviteUserByEmail(email, {
    data: displayName ? { display_name: displayName } : {},
    redirectTo: `${context.origin}/`
  });
  if (invited.error) {
    if (invited.error.message.toLowerCase().includes("already")) return privateJson({ error: "這個電郵已有 Portal 帳戶。" }, 409);
    return privateJson({ error: "未能發出邀請，請稍後再試。" }, 422);
  }
  // Do not log the address or claim that invitation delivery/Google linking
  // has completed. If audit storage fails, never repeat the invitation blindly.
  let auditRecorded = false;
  try {
    const audit = await admin.from("activity_logs").insert({
      resource_type: "account", resource_id: invited.data.user.id,
      actor_id: context.user.id, action: "account_invited",
      summary: "管理員已發出新帳戶邀請。"
    });
    auditRecorded = !audit.error;
  } catch { /* The invitation was already submitted: never report it as unsent. */ }
  return privateJson({ userId: invited.data.user.id, auditRecorded }, 201);
}
