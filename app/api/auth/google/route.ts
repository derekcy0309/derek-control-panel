import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { GOOGLE_CALLBACK_PATH, GOOGLE_FLOW_COOKIE, GOOGLE_FLOW_SECONDS, googleLoginError, googleProviderReady, safeLoginDestination } from "@/lib/google-login";
import { googleOAuthClient } from "@/lib/server/google-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: NextRequest) {
  // Only a deliberate same-origin button press may initiate an OAuth login.
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "請由 Panel 登入頁開始。" }, { status: 403, headers });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return failure("unavailable");
  const body = await request.json().catch(() => null) as { next?: unknown } | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "請重新按登入。" }, { status: 400, headers });
  try {
    const settings = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!settings.ok) return failure("network");
    const readiness = googleProviderReady(await settings.json());
    if (readiness !== "ready") return failure(readiness);

    const state = randomBytes(32).toString("hex");
    const callback = new URL(GOOGLE_CALLBACK_PATH, request.nextUrl.origin);
    callback.searchParams.set("state", state);
    const { client, getVerifier } = googleOAuthClient(url, key);
    const result = await client.auth.signInWithOAuth({ provider: "google", options: {
      redirectTo: callback.href, skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" }
    } });
    const verifier = getVerifier();
    if (result.error || !result.data.url || !verifier) return failure("unavailable");
    const response = NextResponse.json({ url: result.data.url }, { headers });
    response.cookies.set(GOOGLE_FLOW_COOKIE, JSON.stringify({ verifier, state, next: safeLoginDestination(body.next), createdAt: Date.now() }), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/google", maxAge: GOOGLE_FLOW_SECONDS
    });
    return response;
  } catch { return failure("network"); }
}

function failure(code: string) {
  return NextResponse.json({ error: googleLoginError(code) }, { status: 503, headers });
}
