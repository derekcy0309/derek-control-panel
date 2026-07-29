import { NextRequest, NextResponse } from "next/server";
import {
  encryptCalendarToken,
  exchangeGoogleCode,
  expectedGoogleAccount,
  googleAccountEmail,
  listWritableGoogleCalendars,
  verifyGoogleOAuthState
} from "@/lib/integrations/google-calendar";
import { authenticateRequest } from "@/lib/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const code = request.nextUrl.searchParams.get("code");
  const suppliedState = request.nextUrl.searchParams.get("state") ?? "";
  const cookieState = request.cookies.get("dcp_google_oauth")?.value ?? "";
  const state = verifyGoogleOAuthState(suppliedState);
  const redirect = new URL("/settings", context.origin);

  if (!code || !state || suppliedState !== cookieState || state.userId !== context.user.id) {
    redirect.searchParams.set("calendar", "invalid_state");
    return clearOAuthCookie(NextResponse.redirect(redirect));
  }
  try {
    const redirectUri = `${context.origin}/api/integrations/google-calendar/callback`;
    const tokens = await exchangeGoogleCode(code, redirectUri);
    const accountEmail = await googleAccountEmail(tokens.access_token);
    const profile = await context.client.from("user_profiles").select("personal_calendar_email").eq("user_id", context.user.id).maybeSingle();
    if (profile.error) throw new Error(profile.error.message);
    const expectedEmail = expectedGoogleAccount(state.target, context.user.email ?? "", profile.data?.personal_calendar_email);
    if (accountEmail !== expectedEmail) {
      redirect.searchParams.set("calendar", "wrong_account");
      redirect.searchParams.set("expected", expectedEmail);
      return clearOAuthCookie(NextResponse.redirect(redirect));
    }
    const calendars = await listWritableGoogleCalendars(tokens.access_token);
    const selected = calendars.find((calendar) => calendar.primary) ?? calendars[0];
    if (!selected) throw new Error("呢個 Google 帳戶沒有可寫入 Calendar。");

    const connection = await context.client.from("google_calendar_connections").upsert({
      user_id: context.user.id,
      target: state.target,
      account_email: accountEmail,
      calendar_id: selected.id,
      calendar_name: selected.summary,
      status: "connected",
      scopes: tokens.scope?.split(" ") ?? [],
      access_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      last_error: null,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id,target" }).select("*").single();
    if (connection.error) throw new Error(connection.error.message);
    const stored = await context.client.rpc("store_google_calendar_tokens", {
      p_connection_id: connection.data.id,
      p_access_token_ciphertext: encryptCalendarToken(tokens.access_token),
      p_refresh_token_ciphertext: tokens.refresh_token ? encryptCalendarToken(tokens.refresh_token) : ""
    });
    if (stored.error) throw new Error(stored.error.message);
    redirect.searchParams.set("calendar", "connected");
    redirect.searchParams.set("target", state.target);
  } catch (error) {
    redirect.searchParams.set("calendar", "failed");
    redirect.searchParams.set("reason", error instanceof Error ? error.message.slice(0, 160) : "unknown");
  }
  return clearOAuthCookie(NextResponse.redirect(redirect));
}

function clearOAuthCookie(response: NextResponse) {
  response.cookies.set("dcp_google_oauth", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/google-calendar",
    maxAge: 0
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
