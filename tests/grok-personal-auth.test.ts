import assert from "node:assert/strict";
import test from "node:test";
import {
  createGrokPersonalToken,
  grokPersonalOwner,
  grokPersonalTokenHash,
  hashGrokPersonalToken,
} from "../lib/server/grok-personal-auth.ts";
import { hashAgentKey } from "../lib/server/agent-key.ts";

const url = "https://dayline-fixture.test/api/agent/personal";
const request = (headers: Record<string, string> = {}, path = url) => new Request(path, { headers });

test("the Grok personal key is random and isolated from user sessions and all previous Grok credentials", () => {
  const token = createGrokPersonalToken();
  assert.match(token, /^dcp_trusted_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, createGrokPersonalToken());
  assert.equal(hashAgentKey(token), null, "legacy agent must not accept the dedicated key");
  const hash = hashGrokPersonalToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(grokPersonalTokenHash(request({ Authorization: `Bearer ${token}` })), hash);
  assert.equal(grokPersonalTokenHash(request({ Authorization: `bearer ${token}` })), hash);
  for (const authorization of [`Bearer dcp_grok_${"a".repeat(43)}`, `Bearer ${token}, ${token}`, `Bearer ${token}b`, token, "Bearer fake.supabase.jwt"]) {
    assert.equal(grokPersonalTokenHash(request({ Authorization: authorization })), null);
  }
  assert.equal(grokPersonalTokenHash(request({ cookie: `dcp_agent=${token}` })), null);
  assert.equal(grokPersonalTokenHash(request({}, `${url}?token=${token}`)), null);
});

test("owner lookup resolves only from the service RPC and fails closed on denial or malformed result", async (t) => {
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  t.after(() => {
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database-fixture.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-not-a-real-credential";
  const token = createGrokPersonalToken();
  const dbOwner = { ownerId: "11111111-1111-4111-8111-111111111111", connectionId: "11111111-1111-4111-8111-111111111112" };
  const incoming = request({ Authorization: `Bearer ${token}`, "x-owner-id": "attacker" }, `${url}?owner=attacker`);
  let calls = 0;
  let responseBody: unknown = dbOwner;
  let status = 200;
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    calls++;
    assert.equal(input, "https://database-fixture.test/rest/v1/rpc/grok_personal_owner");
    assert.deepEqual(JSON.parse(String(init?.body)), { p_token_hash: hashGrokPersonalToken(token) });
    return Response.json(responseBody, { status });
  });
  assert.equal(await grokPersonalOwner(request()), null);
  assert.equal(calls, 0);
  assert.deepEqual(await grokPersonalOwner(incoming), dbOwner);
  responseBody = null;
  assert.equal(await grokPersonalOwner(incoming), null);
  responseBody = { ownerId: dbOwner.ownerId };
  await assert.rejects(grokPersonalOwner(incoming), /response invalid/);
  responseBody = { code: "42501", message: "raw internal information" };
  status = 403;
  await assert.rejects(grokPersonalOwner(incoming), (error: Error) => error.message === "Grok personal connection check failed");
});
