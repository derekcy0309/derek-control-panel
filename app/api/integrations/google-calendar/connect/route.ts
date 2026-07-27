import { NextRequest, NextResponse } from "next/server";
import {
  createGoogleOAuthState,
  expectedGoogleAccount,
  googleAuthorizationUrl,
  type ConnectedCalendarTarget
} from "@/lib/integrations/google-calendar";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const target = request.nextUrl.searchParams.get("target") as ConnectedCalendarTarget | null;
  if (!target || !["personal", "family", "work"].includes(target)) {
    return privateJson({ error: "Calendar 類型不正確。" }, 422);
  }
  try {
    const profile = await context.client.from("user_profiles").select("personal_calendar_email").eq("user_id", context.user.id).maybeSingle();
    const state = createGoogleOAuthState({
      userId: context.user.id,
      target,
      returnTo: "/settings"
    });
    const redirectUri = `${context.origin}/api/integrations/google-calendar/callback`;
    const response = NextResponse.redirect(googleAuthorizationUrl({
      state,
      redirectUri,
      loginHint: expectedGoogleAccount(target, context.user.email ?? "", profile.data?.personal_calendar_email)
    }));
    response.cookies.set("dcp_google_oauth", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/integrations/google-calendar",
      maxAge: 10 * 60
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    const redirect = new URL("/settings", context.origin);
    redirect.searchParams.set("calendar", "not_configured");
    redirect.searchParams.set("reason", "Google Calendar 管理員設定尚未完成。");
    const response = NextResponse.redirect(redirect);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
