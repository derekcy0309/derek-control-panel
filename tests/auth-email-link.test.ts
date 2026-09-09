import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("email-link session adoption never signs out the newly authenticated user", async () => {
  const source = await readFile(new URL("../components/AuthGate.tsx", import.meta.url), "utf8");

  assert.match(source, /action: "adopt"/);
  assert.match(source, /window\.location\.replace\(window\.location\.pathname\)/);
  assert.doesNotMatch(source, /supabase(?:\?\.)?\.auth\.signOut\(/);
});

test("authenticated sessions are renewed instead of expiring after the access JWT window", async () => {
  const authRoute = await readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8");
  const gate = await readFile(new URL("../components/AuthGate.tsx", import.meta.url), "utf8");

  assert.match(authRoute, /auth\.refreshSession\(\{ refresh_token: refreshToken \}\)/);
  assert.match(authRoute, /accessCookie, accessToken,[\s\S]*maxAge: 60 \* 60 \* 24 \* 30/);
  assert.match(gate, /window\.setInterval\([\s\S]*20 \* 60 \* 1000/);
  assert.match(gate, /document\.addEventListener\("visibilitychange", renewWhenReturning\)/);
});
