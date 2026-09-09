import { createClient, type User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";
import type { AdminAccountUser } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pageSize = 100;
const maxPages = 10;

export async function GET(request: NextRequest) {
  const access = await requireAdministrator(request);
  if (access instanceof Response) return access;
  const { context, admin } = access;

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
      lastSeenAt: profile?.last_seen_at ?? null,
      showEncouragement: encouragementVisibleFor(user)
    };
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return privateJson({ users, truncated, currentUserId: context.user.id });
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== request.nextUrl.origin) {
    return privateJson({ error: "來源驗證失敗。請重新整理頁面後再試。" }, 403);
  }
  const access = await requireAdministrator(request);
  if (access instanceof Response) return access;
  const { context, admin } = access;
  const body = await request.json().catch(() => null) as {
    action?: string;
    targetUserId?: string;
    visible?: boolean;
    confirmEmail?: string;
  } | null;
  const targetUserId = body?.targetUserId?.trim() ?? "";
  if (!isUuid(targetUserId)) return privateJson({ error: "帳戶識別資料無效。" }, 422);

  const targetResult = await admin.auth.admin.getUserById(targetUserId);
  const target = targetResult.data.user;
  if (targetResult.error || !target) return privateJson({ error: "找不到指定帳戶。" }, 404);

  if (body?.action === "set_encouragement_visibility") {
    if (typeof body.visible !== "boolean") return privateJson({ error: "請指定是否顯示鼓勵句。" }, 422);
    const updated = await admin.auth.admin.updateUserById(targetUserId, {
      app_metadata: { ...(target.app_metadata ?? {}), show_encouragement: body.visible }
    });
    if (updated.error || !updated.data.user) return privateJson({ error: "未能更新鼓勵句權限。" }, 502);
    await admin.from("activity_logs").insert({
      resource_type: "account",
      resource_id: targetUserId,
      actor_id: context.user.id,
      action: "encouragement_visibility_changed",
      summary: body.visible ? "管理員已開啟此帳戶的鼓勵句。" : "管理員已關閉此帳戶的鼓勵句。"
    });
    return privateJson({ targetUserId, showEncouragement: body.visible });
  }

  if (body?.action === "delete_account") {
    if (targetUserId === context.user.id) return privateJson({ error: "管理員不可刪除自己目前登入中的帳戶。" }, 422);
    const targetEmail = target.email?.trim().toLowerCase() ?? "";
    if (!targetEmail || body.confirmEmail?.trim().toLowerCase() !== targetEmail) {
      return privateJson({ error: "請完整輸入帳戶電郵以確認永久刪除。" }, 422);
    }
    const profile = await admin.from("user_profiles").select("is_admin").eq("user_id", targetUserId).maybeSingle();
    if (profile.error) return privateJson({ error: "未能核對目標帳戶權限。" }, 502);
    if (profile.data?.is_admin) {
      const administrators = await admin.from("user_profiles").select("user_id", { count: "exact", head: true }).eq("is_admin", true).eq("active", true);
      if (administrators.error) return privateJson({ error: "未能核對現有管理員數目。" }, 502);
      if ((administrators.count ?? 0) <= 1) return privateJson({ error: "不可刪除最後一個啟用中的管理員帳戶。" }, 409);
    }
    const deleted = await admin.auth.admin.deleteUser(targetUserId);
    if (deleted.error) return privateJson({ error: "帳戶仍連結其他資料或檔案，未能安全刪除。" }, 409);
    await admin.from("activity_logs").insert({
      resource_type: "account",
      resource_id: targetUserId,
      actor_id: context.user.id,
      action: "account_deleted",
      summary: `管理員已永久刪除帳戶 ${targetEmail}。`
    });
    return privateJson({ deletedUserId: targetUserId });
  }

  return privateJson({ error: "不支援的管理員操作。" }, 400);
}

async function requireAdministrator(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const administrator = await context.client.from("user_profiles")
    .select("is_admin,active")
    .eq("user_id", context.user.id)
    .maybeSingle();
  if (administrator.error) return privateJson({ error: "未能核對管理員權限。" }, 500);
  if (!administrator.data?.is_admin || !administrator.data.active) {
    return privateJson({ error: "只有啟用中的管理員可以管理帳戶。" }, 403);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return privateJson({ error: "伺服器尚未設定帳戶管理所需的 Service Role Key。" }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return { context, admin };
}

function encouragementVisibleFor(user: User) {
  const configured = user.app_metadata?.show_encouragement;
  if (typeof configured === "boolean") return configured;
  return user.email?.trim().toLowerCase() === "derekcy0309@gmail.com";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function displayNameFor(user: User) {
  const metadata = user.user_metadata ?? {};
  const value = metadata.display_name ?? metadata.full_name ?? metadata.name ?? user.email?.split("@")[0] ?? "未命名帳戶";
  return String(value).slice(0, 100);
}
