import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { GOOGLE_CALLBACK_PATH, googleLoginError, googleProviderReady, readGoogleFlow, safeLoginDestination } from "../lib/google-login.ts";
import { googleOAuthClient } from "../lib/server/google-oauth.ts";

test("Google redirects only return to an internal app page", () => {
  assert.equal(safeLoginDestination("/tasks?code=old&access_token=secret#details"), "/tasks");
  assert.equal(safeLoginDestination("/workspace/note"), "/workspace/note");
  for (const value of [null, "https://evil.test", "//evil.test", "/\\evil.test", "/%2fevil.test", "/%5cevil.test", "/\nevil.test", "/%00", "/api/auth", "/%61pi/auth", "/auth/callback", "/tasks/../api/auth", "/bad%", " /tasks"]) {
    assert.equal(safeLoginDestination(value), "/", String(value));
  }
});

test("PKCE flow cookies expire and reject incomplete/tampered inputs", () => {
  const now = Date.now();
  const flow = { verifier: "a".repeat(64), state: "b".repeat(64), next: "/tasks", createdAt: now };
  assert.deepEqual(readGoogleFlow(JSON.stringify(flow), now), flow);
  assert.equal(readGoogleFlow(JSON.stringify(flow), now + 600001), null);
  assert.equal(readGoogleFlow(JSON.stringify(flow), now - 1), null);
  for (const value of [undefined, "", "{}", "not-json", JSON.stringify({ ...flow, verifier: "short" }), JSON.stringify({ ...flow, state: "bad" })]) assert.equal(readGoogleFlow(value, now), null);
  assert.equal(readGoogleFlow(JSON.stringify({ ...flow, next: "//evil.test" }), now)?.next, "/");
});

test("Google login requires both an enabled provider and closed registration", () => {
  assert.equal(googleProviderReady({ external: { google: true }, disable_signup: true }), "ready");
  assert.equal(googleProviderReady({ external: { google: false }, disable_signup: true }), "unavailable");
  assert.equal(googleProviderReady({ external: { google: true }, disable_signup: false }), "closed_registration_required");
  assert.equal(googleProviderReady({ external: { google: true } }), "closed_registration_required");
  assert.equal(googleProviderReady(null), "unavailable");
});

test("OAuth starts with S256 PKCE, same-origin callback, and no calendar/mail scopes", async () => {
  const { client, getVerifier } = googleOAuthClient("https://test.supabase.co", "test-key");
  const redirectTo = `https://panel.test${GOOGLE_CALLBACK_PATH}?state=${"a".repeat(64)}`;
  const result = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } } });
  assert.equal(result.error, null);
  const url = new URL(result.data.url!);
  const verifier = getVerifier()!;
  assert.ok(verifier.length >= 43);
  assert.equal(url.searchParams.get("provider"), "google");
  assert.equal(url.searchParams.get("redirect_to"), redirectTo);
  assert.equal(url.searchParams.get("code_challenge_method"), "s256");
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(verifier).digest("base64url"));
  assert.equal(url.searchParams.get("scopes"), null);
  assert.equal(url.searchParams.get("access_type"), null);
});

test("PKCE exchange restores the server verifier and does not persist it after use", async () => {
  let body: Record<string, unknown> = {};
  const mockFetch: typeof fetch = async (_url, options) => {
    body = JSON.parse(String(options?.body));
    return Response.json({ access_token: "session-token", refresh_token: "refresh-token", expires_in: 3600, token_type: "bearer", user: { id: "existing-id" } });
  };
  const { client, getVerifier } = googleOAuthClient("https://test.supabase.co", "test-key", "v".repeat(64), mockFetch);
  const result = await client.auth.exchangeCodeForSession("one-time-code");
  assert.equal(result.error, null);
  assert.equal(result.data.user?.id, "existing-id");
  assert.equal(body.code_verifier, "v".repeat(64));
  assert.equal(body.auth_code, "one-time-code");
  assert.equal(getVerifier(), null);
});

test("Google errors give a next action without disclosing provider errors or tokens", () => {
  assert.match(googleLoginError("cancelled"), /已取消/);
  assert.match(googleLoginError("expired"), /同一個視窗/);
  assert.match(googleLoginError("account"), /相同的電郵/);
  assert.doesNotMatch(googleLoginError("secret-token-from-provider"), /secret-token/);
});

test("Google routes verify state, remote user and active RLS profile before setting session", async () => {
  const callback = await readFile(new URL("../app/api/auth/google/callback/route.ts", import.meta.url), "utf8");
  const start = await readFile(new URL("../app/api/auth/google/route.ts", import.meta.url), "utf8");
  const cookieSource = await readFile(new URL("../lib/server/auth-cookies.ts", import.meta.url), "utf8");
  assert.match(start, /request\.headers\.get\("origin"\) !== request\.nextUrl\.origin/);
  assert.match(callback, /timingSafeEqual/);
  assert.match(callback, /auth\.getUser\(result\.data\.session\.access_token\)/);
  assert.match(callback, /identity\.identity_data\?\.email_verified === true/);
  assert.match(callback, /identity\.identity_data\.email\.toLowerCase\(\) === user\.email\?\.toLowerCase\(\)/);
  assert.match(callback, /from\("user_profiles"\)[\s\S]*eq\("user_id", user\.id\)/);
  assert.match(callback, /profile\?\.data\?\.active/);
  assert.ok(callback.indexOf('return failure("account")') < callback.indexOf("setSession(response"));
  assert.match(cookieSource, /httpOnly: true, secure, sameSite: "lax"/);
  assert.doesNotMatch(start + callback, /SERVICE_ROLE|\.insert\(|\.upsert\(|\.update\(|createUser|signUp\(/);
});

test("only an active administrator on the same origin may invite additional accounts", async () => {
  const invite = await readFile(new URL("../app/api/admin/invite/route.ts", import.meta.url), "utf8");
  assert.match(invite, /request\.headers\.get\("origin"\) !== request\.nextUrl\.origin/);
  assert.match(invite, /select\("is_admin,active"\)/);
  assert.match(invite, /!profile\.data\?\.is_admin \|\| !profile\.data\.active/);
  assert.ok(invite.indexOf("!profile.data?.is_admin") < invite.indexOf("inviteUserByEmail"));
  assert.match(invite, /account_invited/);
  assert.match(invite, /auditRecorded = !audit\.error/);
  assert.doesNotMatch(invite, /summary:.*email/);
});
