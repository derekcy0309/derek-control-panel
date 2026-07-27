import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const body = await request.json().catch(() => null) as { email?: string; displayName?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const displayName = body?.displayName?.trim().slice(0, 100) ?? "";
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return privateJson({ error: "請輸入新用戶的完整電郵地址。" }, 422);

  const profile = await context.client.from("user_profiles")
    .select("is_admin")
    .eq("user_id", context.user.id)
    .maybeSingle();
  if (profile.error) return privateJson({ error: "未能核對管理員權限。" }, 500);
  if (!profile.data?.is_admin) return privateJson({ error: "只有管理員可以邀請新用戶。" }, 403);

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
  return privateJson({ userId: invited.data.user.id }, 201);
}
