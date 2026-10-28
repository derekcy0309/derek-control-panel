import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { GOOGLE_FLOW_COOKIE, readGoogleFlow } from "@/lib/google-login";
import { googleOAuthClient } from "@/lib/server/google-oauth";
import { setSession } from "@/lib/server/auth-cookies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const flow = readGoogleFlow(request.cookies.get(GOOGLE_FLOW_COOKIE)?.value);
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const failure = (reason: string) => {
    const destination = new URL(flow?.next ?? "/", request.nextUrl.origin);
    destination.searchParams.set("login_error", reason);
    return finish(NextResponse.redirect(destination, 303));
  };
  if (!flow || !/^[a-f0-9]{64}$/.test(state) || !timingSafeEqual(Buffer.from(flow.state), Buffer.from(state))) return failure("expired");
  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) return failure(providerError === "access_denied" ? "cancelled" : "failed");
  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.length > 2048 || /\s/.test(code)) return failure("expired");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return failure("unavailable");

  try {
    const { client } = googleOAuthClient(url, key, flow.verifier);
    const result = await client.auth.exchangeCodeForSession(code);
    if (result.error || !result.data.session || !result.data.user) return failure("failed");
    // Auth server verification + an RLS-scoped active profile, not browser
    // metadata or a guessed email-to-user mapping. No data/role migration.
    const verified = await client.auth.getUser(result.data.session.access_token);
    const user = verified.data.user;
    const profile = user ? await client.from("user_profiles").select("user_id,active").eq("user_id", user.id).maybeSingle() : null;
    if (verified.error || !user?.email_confirmed_at || !user.identities?.some(identity => identity.provider === "google")
      || profile?.error || !profile?.data?.active || profile.data.user_id !== user.id) {
      await client.auth.signOut({ scope: "local" });
      return failure("account");
    }
    const response = NextResponse.redirect(new URL(flow.next, request.nextUrl.origin), 303);
    return finish(setSession(response, result.data.session.access_token, result.data.session.refresh_token));
  } catch { return failure("network"); }
}

function finish(response: NextResponse) {
  response.cookies.set(GOOGLE_FLOW_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/google", maxAge: 0 });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
