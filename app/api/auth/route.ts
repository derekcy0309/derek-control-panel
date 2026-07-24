import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const accessCookie = "dcp_access";
const refreshCookie = "dcp_refresh";

export async function GET(request: NextRequest) {
  const client = serverClient();
  if (!client) return error("伺服器尚未設定資料庫。", 503);
  const accessToken = request.cookies.get(accessCookie)?.value;
  const refreshToken = request.cookies.get(refreshCookie)?.value;
  if (!accessToken || !refreshToken) return error("未登入。", 401);
  const session = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (session.error || !session.data.user || !session.data.session) return clearSession(error("登入已失效，請重新登入。", 401));
  return setSession(NextResponse.json({
    user: { id: session.data.user.id, email: session.data.user.email ?? "", displayName: inferName(session.data.user) }
  }, { headers: privateHeaders() }), session.data.session.access_token, session.data.session.refresh_token);
}

export async function POST(request: NextRequest) {
  const client = serverClient();
  if (!client) return error("伺服器尚未設定資料庫。", 503);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "password";

  if (action === "password") {
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) return error("請輸入電郵及密碼。", 422);
    const result = await client.auth.signInWithPassword({ email, password });
    if (result.error || !result.data.session) return error(formatLoginError(result.error?.message ?? ""), 401);
    return setSession(NextResponse.json({ user: { id: result.data.user.id, email: result.data.user.email ?? "", displayName: inferName(result.data.user) } }, { headers: privateHeaders() }), result.data.session.access_token, result.data.session.refresh_token);
  }

  if (action === "adopt") {
    const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
    const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";
    if (!accessToken || !refreshToken) return error("登入連結資料不完整。", 400);
    const result = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (result.error || !result.data.session) return error("登入連結無效或已過期。", 401);
    return setSession(NextResponse.json({ ok: true }, { headers: privateHeaders() }), result.data.session.access_token, result.data.session.refresh_token);
  }

  if (action === "change_password") {
    const accessToken = request.cookies.get(accessCookie)?.value;
    const refreshToken = request.cookies.get(refreshCookie)?.value;
    const password = typeof body.password === "string" ? body.password : "";
    if (!accessToken || !refreshToken) return error("登入已失效，請重新登入。", 401);
    if (password.length < 8) return error("新密碼最少需要 8 個字元。", 422);
    const session = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (session.error || !session.data.user) return clearSession(error("登入已失效，請重新登入。", 401));
    const updated = await client.auth.updateUser({ password });
    if (updated.error) return error("未能更新密碼，請使用另一個較強密碼。", 422);
    const profile = await client.from("user_profiles").update({ must_change_password: false }).eq("user_id", session.data.user.id);
    if (profile.error) return error("密碼已更新，但未能完成首次登入標記。請重新登入。", 500);
    return NextResponse.json({ ok: true }, { headers: privateHeaders() });
  }

  return error("不支援的登入操作。", 400);
}

export async function DELETE(request: NextRequest) {
  const client = serverClient();
  const accessToken = request.cookies.get(accessCookie)?.value;
  const refreshToken = request.cookies.get(refreshCookie)?.value;
  if (client && accessToken && refreshToken) {
    await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    await client.auth.signOut({ scope: "local" });
  }
  return clearSession(NextResponse.json({ ok: true }, { headers: privateHeaders() }));
}

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function setSession(response: NextResponse, accessToken: string, refreshToken: string) {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(accessCookie, accessToken, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 });
  response.cookies.set(refreshCookie, refreshToken, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return response;
}

function clearSession(response: NextResponse) {
  response.cookies.set(accessCookie, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  response.cookies.set(refreshCookie, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}

function inferName(user: { email?: string; user_metadata?: Record<string, unknown> }) {
  const metadata = user.user_metadata ?? {};
  const raw = metadata.display_name || metadata.full_name || metadata.name || user.email?.split("@")[0] || "User";
  const name = String(raw);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatLoginError(message: string) {
  if (message.includes("Invalid login credentials")) return "電郵或密碼不正確。";
  if (message.includes("Email not confirmed")) return "此電郵尚未完成確認。";
  if (message.includes("disabled")) return "Supabase Email 登入尚未啟用。";
  return "登入失敗，請檢查資料後再試。";
}

function privateHeaders() { return { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" }; }
function error(message: string, status: number) { return NextResponse.json({ error: message }, { status, headers: privateHeaders() }); }
