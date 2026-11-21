// Exercises the real UI-facing Next handlers; fixture accounts/data only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";

const base = "http://localhost:3152";
const endpoint = base + "/api/agent-access/personal";
const manifest = base + "/api/agent/personal";
const botArchive = manifest + "/archive-requests";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const proposal = "44444444-4444-4444-8444-444444444444";
const record = "55555555-5555-4555-8555-555555555555";
const tokenFor = (sub, secondsAgo) => {
  const claims = { sub, session_id: session, role: "authenticated", amr: [{ method: "oauth", timestamp: Math.floor(Date.now()/1000) - secondsAgo }] };
  return "fixture." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".fixture";
};
const fresh = tokenFor(owner, 0), stale = tokenFor(owner, 601), otherAccount = tokenFor(other, 0);
const agent = "dcp_trusted_" + "a".repeat(43);
const account = "fixture-derek@example.test";
const expectedLogin = "derekcy0309@gmail.com"; // Fixture only; match the owner allowlist.
const expiresAt = "2027-01-01T00:00:00Z";
let archiveCalls = 0, keyChanges = 0, storedHash = null, pending = false, currentSession = true, logs = "";
let draftWrites = 0;

async function readJson(req) {
  let raw = "";
  for await (const data of req) raw += data;
  return JSON.parse(raw || "{}");
}

const backend = http.createServer(async (req, res) => {
  let status = 200;
  let result;
  try {
    if (req.url === "/auth/v1/user") {
      if ([fresh, stale, otherAccount].some(value => req.headers.authorization === "Bearer " + value)) {
        const who = req.headers.authorization === "Bearer " + otherAccount ? other : owner;
        result = { id: who, email: who === owner ? expectedLogin : account, email_confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false };
      } else {
        status = 401;
        result = { message: "invalid user token" };
      }
    } else if (req.url === "/rest/v1/rpc/touch_current_user_last_seen") {
      result = null;
    } else if (req.url?.startsWith("/rest/v1/user_profiles?")) {
      assert.equal(new URL(req.url, base).searchParams.get("user_id"), "eq." + owner);
      result = [{ is_admin: true, active: true }];
    } else if (req.url === "/rest/v1/rpc/grok_personal_connection") {
      const body = await readJson(req);
      assert.equal(req.headers.authorization, "Bearer fixture-service");
      assert.equal(body.p_owner_id, owner);
      if (body.p_action === "rotate") {
        assert.equal(body.p_session_id, session);
        assert.match(body.p_token_hash, /^[a-f0-9]{64}$/);
        if (!currentSession) result = { status: "reauth", connected: false };
        else {
          storedHash = body.p_token_hash;
          keyChanges++;
        }
      } else {
        assert.equal(body.p_token_hash, null);
        assert.equal(body.p_session_id, null);
        if (body.p_action === "revoke") { storedHash = null; pending = false; keyChanges++; }
      }
      result ??= { connected: storedHash !== null, expiresAt: storedHash ? expiresAt : null };
    } else if (req.url === "/rest/v1/rpc/grok_personal_owner") {
      assert.equal(req.headers.authorization, "Bearer fixture-service");
      const body = await readJson(req);
      assert.deepEqual(Object.keys(body), ["p_token_hash"]);
      assert.match(body.p_token_hash, /^[a-f0-9]{64}$/);
      result = storedHash && body.p_token_hash === storedHash ? { ownerId: owner, connectionId: session } : null;
    } else if (req.url === "/rest/v1/rpc/grok_personal_request_archive") {
      assert.equal(req.headers.authorization, "Bearer fixture-service");
      const body = await readJson(req);
      assert.deepEqual(Object.keys(body).sort(), ["p_dataset", "p_record_id", "p_token_hash"]);
      assert.match(body.p_token_hash, /^[a-f0-9]{64}$/);
      assert.equal(body.p_dataset, "finance_transactions");
      if (storedHash && body.p_token_hash === storedHash && body.p_record_id === record) {
        if (!pending) draftWrites++;
        pending = true;
        result = { requestId: proposal, status: "pending" };
      } else result = null;
    } else if (req.url === "/rest/v1/rpc/grok_personal_archives") {
      assert.equal(req.headers.authorization, "Bearer fixture-service");
      assert.deepEqual(await readJson(req), { p_owner_id: owner });
      result = pending ? [{ id: proposal, dataset: "finance_transactions", recordId: record, label: "Fixture expense", status: "pending", createdAt: "2026-11-22T00:00:00Z", ignoredField: "should not serialize" }] : [];
    } else if (req.url === "/rest/v1/rpc/grok_personal_decide_archive") {
      const body = await readJson(req);
      assert.equal(req.headers.authorization, "Bearer " + fresh);
      assert.deepEqual(body, { p_owner_id: owner, p_request_id: proposal, p_decision: "confirm", p_session_id: session, p_owner_ordered: true, p_confirmation: "archive" });
      archiveCalls++;
      if (!currentSession) result = { status: "reauth" };
      else { pending = false; result = { status: "archived" }; }
    } else {
      status = 404;
      result = { message: "unexpected fixture endpoint" };
    }
  } catch (error) {
    logs += String(error);
    status = 500;
    result = { message: "fixture check failed" };
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
});
await new Promise(resolve => backend.listen(4189, "127.0.0.1", resolve));

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "-p", "3152"], {
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:4189", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon", SUPABASE_SERVICE_ROLE_KEY: "fixture-service", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"]
});
server.stdout.on("data", output => { logs += output; });
server.stderr.on("data", output => { logs += output; });
const userCookie = value => ({ Cookie: "dcp_access=" + value });
const send = (data, token = fresh, overrides = {}) => fetch(endpoint, {
  method: "POST", body: JSON.stringify(data),
  headers: { Origin: base, "Content-Type": "application/json", ...userCookie(token), ...overrides }
});
const rotate = { action: "rotate", consent: true };
const confirm = { action: "confirm", requestId: proposal, ownerOrdered: true, confirmation: "archive" };
const botAuth = accessCode => ({ Authorization: "Bearer " + accessCode });
const draft = { dataset: "finance_transactions", recordId: record };
const sendDraft = (body, accessCode, overrides = {}) => fetch(botArchive, {
  method: "POST", body: JSON.stringify(body), headers: { ...botAuth(accessCode), "Content-Type": "application/json", ...overrides }
});

try {
  let ready = false;
  for (let i = 0; i < 100 && server.exitCode === null; i++) {
    try { if ((await fetch(endpoint)).status === 401) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  assert.ok(ready, "Next owner endpoint is ready");
  assert.equal((await fetch(endpoint, { headers: { Authorization: "Bearer " + agent } })).status, 401);
  assert.equal((await fetch(endpoint, { headers: userCookie(otherAccount) })).status, 403);
  assert.equal((await fetch(endpoint, { headers: { Cookie: "dcp_agent=" + agent } })).status, 401);
  assert.equal((await send(rotate, fresh, { Origin: "https://example.test" })).status, 403);
  assert.equal((await send(rotate, fresh, { Authorization: "Bearer " + agent })).status, 401);
  assert.equal((await send(rotate, fresh, { "Content-Type": "application/json-not-json" })).status, 415);
  assert.equal((await send({ action: "rotate" })).status, 422);
  assert.equal((await send({ ...rotate, ownerId: other })).status, 422);
  assert.equal((await send(rotate, stale)).status, 401);
  assert.equal(keyChanges, 0);
  currentSession = false;
  assert.equal((await send(rotate)).status, 401);
  assert.equal(keyChanges, 0);
  currentSession = true;
  const newCode = await send(rotate);
  assert.equal(newCode.status, 201);
  assert.match(newCode.headers.get("cache-control"), /private, no-store/);
  const created = await newCode.json();
  assert.match(created.accessCode, /^dcp_trusted_[A-Za-z0-9_-]{43}$/);
  assert.equal(storedHash, createHash("sha256").update(created.accessCode).digest("hex"));
  assert.equal(created.expiresAt, expiresAt);
  assert.equal((await fetch(manifest)).status, 401);
  assert.equal((await fetch(manifest, { headers: botAuth(agent) })).status, 401);
  assert.equal((await fetch(manifest + "?ownerId=" + other, { headers: botAuth(created.accessCode) })).status, 400);
  const read = await fetch(manifest, { headers: botAuth(created.accessCode) });
  assert.equal(read.status, 200);
  assert.match(read.headers.get("cache-control"), /private, no-store/);
  const catalog = (await read.json()).datasets;
  assert.ok(catalog.some(item => item.dataset === "finance_transactions"));
  assert.ok(catalog.some(item => item.dataset === "icloud" && item.month === "required"));
  for (const method of ["DELETE", "PUT", "PATCH"]) {
    for (const route of [manifest, botArchive]) {
      const direct = await fetch(route, { method, headers: botAuth(created.accessCode) });
      assert.ok([403, 405].includes(direct.status), "bot write method cannot be used directly");
    }
  }
  assert.equal((await sendDraft(draft, fresh)).status, 401);
  assert.equal((await sendDraft(draft, created.accessCode, { Origin: "https://example.test" })).status, 403);
  for (const bad of [{ ...draft, ownerId: other }, { ...draft, dataset: "icloud" }, { ...draft, recordId: [record] }, { ...draft, action: "confirm" }]) {
    assert.equal((await sendDraft(bad, created.accessCode)).status, 422);
  }
  assert.equal((await sendDraft({ ...draft, recordId: other }, created.accessCode)).status, 404);
  assert.equal(archiveCalls, 0);
  const firstDraft = await sendDraft(draft, created.accessCode);
  const repeatDraft = await sendDraft(draft, created.accessCode);
  assert.equal(firstDraft.status, 202);
  assert.equal(repeatDraft.status, 202);
  assert.match(firstDraft.headers.get("cache-control"), /private, no-store/);
  const firstData = await firstDraft.json(), repeatedData = await repeatDraft.json();
  assert.equal(firstData.requestId, proposal);
  assert.equal(firstData.status, "pending");
  assert.equal(firstData.archived, false);
  assert.equal(repeatedData.requestId, firstData.requestId);
  assert.equal(draftWrites, 1);
  assert.equal(archiveCalls, 0);
  const state = await fetch(endpoint, { headers: userCookie(fresh) });
  const stateData = await state.json();
  assert.equal(state.status, 200);
  assert.equal(stateData.accessCode, undefined);
  assert.equal(stateData.pending[0].ignoredField, undefined);
  assert.equal(stateData.pending[0].recordId, record);
  assert.equal((await send({ action: "confirm", requestId: proposal, ownerOrdered: true })).status, 422);
  assert.equal((await send({ ...confirm, ownerOrdered: false })).status, 422);
  assert.equal((await send(confirm, stale)).status, 401);
  assert.equal(archiveCalls, 0);
  currentSession = false;
  assert.equal((await send(confirm)).status, 401);
  assert.equal(pending, true);
  currentSession = true;
  assert.deepEqual(await (await send(confirm)).json(), { status: "archived" });
  assert.equal(pending, false);
  const nextCode = await (await send(rotate)).json();
  assert.notEqual(created.accessCode, nextCode.accessCode);
  assert.equal((await fetch(manifest, { headers: botAuth(created.accessCode) })).status, 401);
  assert.equal((await sendDraft(draft, created.accessCode)).status, 404);
  assert.equal((await fetch(manifest, { headers: botAuth(nextCode.accessCode) })).status, 200);
  assert.equal((await send({ action: "revoke" }, stale)).status, 200);
  assert.equal(storedHash, null);
  assert.equal(keyChanges, 3);
  assert.equal((await fetch(manifest, { headers: botAuth(nextCode.accessCode) })).status, 401);
  assert.equal((await sendDraft(draft, nextCode.accessCode)).status, 404);
  assert.ok(!logs.includes(created.accessCode));
  assert.ok(!logs.includes(nextCode.accessCode));
  console.log("PASS trusted Grok HTTP API: owner-only consent, fresh session, read catalog, draft-only/replay, human archive, rotation/revoke and no plaintext in logs");
} catch (error) {
  throw new Error(error.message + "\n" + logs.slice(-2200), { cause: error });
} finally {
  server.kill();
  await new Promise(resolve => backend.close(resolve));
}
