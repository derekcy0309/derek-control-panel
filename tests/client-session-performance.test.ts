import assert from "node:assert/strict";
import test from "node:test";
import { checkClientSession, clearClientSessionCheck, clientSessionIdentity, prepareClientSignOut, resumeClientSessionChecks } from "../lib/client-session.ts";

test("task pages reuse the confirmed browser session and cannot revive a signed-out account from an in-flight check", async (t) => {
  const requests: Array<{ signal: AbortSignal; finish: (response: Response) => void }> = [];
  t.mock.method(globalThis, "fetch", (url: string, init: RequestInit) => {
    assert.equal(url, "/api/auth");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    return new Promise<Response>(finish => requests.push({ signal: init.signal!, finish }));
  });
  t.after(() => { resumeClientSessionChecks(); clearClientSessionCheck(); });
  clearClientSessionCheck();
  const gate = checkClientSession();
  const shell = checkClientSession();
  assert.equal(gate, shell, "simultaneous startup shares one pending check");
  assert.equal(requests.length, 1);
  requests[0].finish(Response.json({ user: { id: "owner-one" } }));
  assert.equal(await gate, true);
  assert.equal(await checkClientSession(), true);
  assert.equal(clientSessionIdentity(), "owner-one");
  assert.equal(requests.length, 1, "the recent AuthGate check satisfies first data fetches");

  const outstanding = checkClientSession(0);
  assert.equal(requests.length, 2);
  prepareClientSignOut();
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(await checkClientSession(), false);
  requests[1].finish(Response.json({ user: { id: "owner-one" } }));
  assert.equal(await outstanding, false, "even a late passing refresh cannot restore the old identity");
  assert.equal(clientSessionIdentity(), null);

  resumeClientSessionChecks();
  const newOwner = checkClientSession();
  assert.equal(requests.length, 3);
  requests[2].finish(Response.json({ user: { id: "owner-two" } }));
  assert.equal(await newOwner, true);
  assert.equal(clientSessionIdentity(), "owner-two");
});
