// Run the real Next.js handlers with a loopback Supabase stub; no live credentials.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";

const origin = "http://localhost:3157";
const path = "/api/agent-access/archive-requests";
const actor = crypto.randomUUID(), session = crypto.randomUUID(), id = crypto.randomUUID();
const fixtureAgentCode = "dcp_grok_" + "x".repeat(43);
const signedStub = (age) => ["fixture", Buffer.from(JSON.stringify({
  sub: actor, role: "authenticated", is_anonymous: false, session_id: session,
  amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) - age }]
})).toString("base64url"), "fixture"].join(".");
// These stub tokens are accepted only by the mock; all browser-facing code is real.
const recent = signedStub(1), old = signedStub(601);
let reads = 0, writes = 0, responseStatus = "archived", profileAdmin = true, logs = "";
const row = { id, label: "隔離測試任務", kind: "task", grantLabel: "隔離 Agent", createdAt: new Date().toISOString() };

const db = http.createServer(async (request, response) => {
  const json = result => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(result));
  };
  if (![recent, old].some(token => request.headers.authorization === "Bearer " + token)) {
    response.statusCode = 401; return json({ message: "invalid fixture token" });
  }
  if (request.url === "/auth/v1/user") return json({
    id: actor, role: "authenticated", aud: "authenticated", email_confirmed_at: new Date().toISOString()
  });
  if (request.url === "/rest/v1/rpc/touch_current_user_last_seen") return json(null);
  if (request.url?.startsWith("/rest/v1/user_profiles?")) return json([{ active: true, is_admin: profileAdmin }]);
  if (request.url === "/rest/v1/rpc/owner_workspace_archive_reviews") {
    reads++;
    return json([{ ...row, recordVersion: "backend-only", body: "不應回傳全文" }]);
  }
  if (request.url === "/rest/v1/rpc/decide_owner_workspace_archive") {
    writes++;
    let body = "";
    for await (const chunk of request) body += chunk;
    let p;
    try { p = JSON.parse(body); }
    catch { response.statusCode = 400; return json({ message: "fixture body invalid" }); }
    const allowed = p.p_request_id === id &&
      (p.p_decision === "confirm"
        ? request.headers.authorization === "Bearer " + recent && p.p_session_id === session && p.p_owner_ordered === true && p.p_confirmation === "archive"
        : p.p_decision === "dismiss" && p.p_session_id === null && p.p_owner_ordered === false && p.p_confirmation === null);
    if (!allowed) { response.statusCode = 422; return json({ message: "fixture incorrect arguments" }); }
    return json({ status: p.p_decision === "dismiss" ? "dismissed" : responseStatus, detail: "不應回傳額外資料" });
  }
  response.statusCode = 404; return json({ message: "unexpected fixture endpoint" });
});
await new Promise(resolve => db.listen(0, "127.0.0.1", resolve));
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "-p", "3157"], {
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:" + db.address().port,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon", SUPABASE_SERVICE_ROLE_KEY: "stub-service",
    NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"]
});
next.stdout.on("data", data => { logs += data; });
next.stderr.on("data", data => { logs += data; });
const request = (route = path, init = {}) => fetch(origin + route, init);
const sessionHeaders = token => ({ Cookie: "dcp_access=" + token });
const confirm = { id, decision: "confirm", ownerOrdered: true, confirmation: "archive" };
const post = (body, headers = {}, token = recent) => request(path, { method: "POST",
  headers: { ...sessionHeaders(token), Origin: origin, "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body)
});
try {
  let started = false;
  for (let i = 0; i < 80; i++) {
    if (next.exitCode !== null) break;
    try { if ((await request()).status === 401) { started = true; break; } }
    catch { /* Wait for the loopback dev handler. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(started, "Loopback handler failed to become ready");
  assert.equal((await request(path, { headers: { Authorization: "Bearer " + fixtureAgentCode } })).status, 401);
  assert.equal((await request(path, { headers: { Cookie: "dcp_agent=" + fixtureAgentCode } })).status, 401);
  assert.equal((await request(path, { headers: { ...sessionHeaders(recent), Authorization: "Bearer " + fixtureAgentCode } })).status, 401);
  assert.equal((await request(path + "?owner_id=" + actor, { headers: sessionHeaders(recent) })).status, 403);
  profileAdmin = false;
  assert.equal((await request(path, { headers: sessionHeaders(recent) })).status, 403);
  profileAdmin = true;
  assert.equal(reads, 0);
  const review = await request(path, { headers: sessionHeaders(recent) });
  assert.equal(review.status, 200); assert.match(review.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await review.json(), { requests: [row] });
  assert.equal((await post(confirm, { Origin: "https://unauthorized.example" })).status, 403);
  assert.equal((await post(confirm, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post({ ...confirm, ownerOrdered: false })).status, 422);
  assert.equal((await post({ ...confirm, ownerId: actor })).status, 422);
  assert.equal((await post(confirm, { Authorization: "Bearer " + fixtureAgentCode })).status, 401);
  const stale = await post(confirm, {}, old);
  assert.equal(stale.status, 401);
  assert.equal((await stale.json()).reauth, true);
  assert.equal(writes, 0);
  const accepted = await post(confirm);
  assert.equal(accepted.status, 200); assert.deepEqual(await accepted.json(), { status: "archived" });
  responseStatus = "disabled";
  const disabled = await post(confirm);
  assert.equal(disabled.status, 409);
  assert.equal((await disabled.json()).status, "disabled");
  const dismiss = await post({ id, decision: "dismiss" }, {}, old);
  assert.equal(dismiss.status, 200); assert.deepEqual(await dismiss.json(), { status: "dismissed" });
  console.log("Owner Agent archive HTTP: human cookie only, CSRF validation, private metadata, verified fresh AMR, confirm/dismiss PASS");
} catch (error) {
  throw new Error(error.message + "\n" + logs.slice(-2200), { cause: error });
} finally {
  next.kill();
  await new Promise(resolve => db.close(resolve));
}
