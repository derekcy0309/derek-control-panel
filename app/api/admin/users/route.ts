import { createClient, type User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";
import type { AdminAccountUser } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pageSize = 100;
const maxPages = 10;

export async function GET(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;

  const administrator = await context.client.from("user_profiles")
    .select("is_admin,active")
    .eq("user_id", context.user.id)
    .maybeSingle();
  if (administrator.error) return privateJson({ error: "未能核對管理員權限。" }, 500);
  if (!administrator.data?.is_admin || !administrator.data.active) {
    return privateJson({ error: "只有啟用中的管理員可以查看帳戶活動。" }, 403);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return privateJson({ error: "伺服器尚未設定管理員帳戶清單所需的 Service Role Key。" }, 503);
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const authUsers: User[] = [];
  let truncated = false;
  for (let page = 1; page <= maxPages; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: pageSize });
    if (listed.error) return privateJson({ error: "未能讀取帳戶清單，請稍後再試。" }, 502);
    const users = listed.data.users;
    authUsers.push(...users);
    if (users.length < pageSize) break;
    if (page === maxPages) truncated = true;
  }

  const profileResult = authUsers.length
    ? await admin.from("user_profiles")
      .select("user_id,display_name,active,is_admin,must_change_password,last_seen_at")
      .in("user_id", authUsers.map((user) => user.id))
    : { data: [], error: null };
  if (profileResult.error) return privateJson({ error: "未能讀取帳戶活動資料，請稍後再試。" }, 502);

  const profileById = new Map((profileResult.data ?? []).map((profile) => [profile.user_id, profile]));
  const users: AdminAccountUser[] = authUsers.map((user) => {
    const profile = profileById.get(user.id);
    return {
      id: user.id,
      email: user.email ?? "",
      displayName: profile?.display_name ?? displayNameFor(user),
      active: profile?.active ?? false,
      isAdmin: profile?.is_admin ?? false,
      mustChangePassword: profile?.must_change_password ?? false,
      createdAt: user.created_at,
      emailConfirmedAt: user.email_confirmed_at ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
      lastSeenAt: profile?.last_seen_at ?? null
    };
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return privateJson({ users, truncated });
}

function displayNameFor(user: User) {
  const metadata = user.user_metadata ?? {};
  const value = metadata.display_name ?? metadata.full_name ?? metadata.name ?? user.email?.split("@")[0] ?? "未命名帳戶";
  return String(value).slice(0, 100);
}
