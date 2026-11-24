import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { briefWindow, GOOGLE_WORK_SOURCE, type BriefEvent } from "../lib/calendar-brief.ts";
import { GoogleCalendarAuthorizationError, type GoogleConnection } from "../lib/integrations/google-calendar.ts";
import { readDashboardGoogleWorkAgenda } from "../lib/server/google-work-agenda.ts";

const owner = "owner";
const selected = {
  id: "work-connection", user_id: owner, target: "work", account_email: "work@example.test",
  calendar_id: "selected-calendar", calendar_name: "Work", status: "connected", access_expires_at: null,
  show_work_in_agenda: true
};
const w = briefWindow(new Date("2026-11-24T08:30:00+08:00"));
const event: BriefEvent = {
  id: "google-only", uid: "google-only", title: "Fixture event", source: GOOGLE_WORK_SOURCE,
  allDay: false, start: "2026-11-24T09:00:00+08:00", end: "2026-11-24T09:30:00+08:00"
};
type Selection = typeof selected | null;
function fixture(selections: Selection[], failure?: Error) {
  const trace: unknown[][] = [];
  const client = {
    from(table: string) {
      trace.push(["table", table]);
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { trace.push(["where", key, value]); return query; },
        abortSignal(signal: AbortSignal) { assert.equal(signal.aborted, false); return query; },
        async maybeSingle() { return { data: selections.shift(), error: null }; }
      };
      return query;
    }
  } as unknown as SupabaseClient;
  return {
    trace, client,
    dependencies: {
      async token(requestClient: SupabaseClient, connection: GoogleConnection, options?: { persist?: boolean }) {
        assert.equal(requestClient, client);
        assert.equal(options?.persist, false);
        trace.push(["token", connection.id]);
        return "test-token";
      },
      async list(token: string, calendarId: string, window: typeof w) {
        trace.push(["list", token, calendarId, window]);
        if (failure) throw failure;
        return { events: [event], truncated: false };
      }
    }
  };
}

test("unselected work agenda never requests any Google token or data", async () => {
  const f = fixture([null]);
  assert.deepEqual(await readDashboardGoogleWorkAgenda(f.client, owner, w, f.dependencies),
    { events: [], source: null, truncated: false });
  assert.deepEqual(f.trace, [
    ["table", "google_calendar_connections"], ["where", "user_id", owner], ["where", "target", "work"], ["where", "show_work_in_agenda", true]
  ]);
});

test("consented work agenda uses the exact current calendar and rechecks consent", async () => {
  const f = fixture([selected, selected]);
  const result = await readDashboardGoogleWorkAgenda(f.client, owner, w, f.dependencies);
  assert.deepEqual(result.events, [event]);
  assert.equal(result.source?.state, "fresh");
  assert.ok(f.trace.some(x => x[0] === "list" && x[2] === selected.calendar_id));
  assert.equal(f.trace.filter(x => x[0] === "table").length, 2);
});

test("in-flight response is discarded when consent, account, or calendar changes", async () => {
  for (const latest of [null, { ...selected, calendar_id: "other" }, { ...selected, account_email: "other@example.test" }]) {
    const f = fixture([selected, latest]);
    assert.deepEqual(await readDashboardGoogleWorkAgenda(f.client, owner, w, f.dependencies),
      { events: [], source: null, truncated: false });
  }
});

test("Google failure is a source warning, not an empty success or a credential leak", async () => {
  const f = fixture([selected], new Error("sensitive provider detail"));
  const failed = await readDashboardGoogleWorkAgenda(f.client, owner, w, f.dependencies);
  assert.equal(failed.source?.errorCode, "GOOGLE_UNAVAILABLE");
  assert.equal(failed.source?.state, "stale");
  assert.doesNotMatch(JSON.stringify(failed), /sensitive provider detail/);
  const withInvalidGrant = fixture([selected]);
  const reconnect = await readDashboardGoogleWorkAgenda(withInvalidGrant.client, owner, w, {
    ...withInvalidGrant.dependencies,
    async token() { throw new GoogleCalendarAuthorizationError("secret"); }
  });
  assert.equal(reconnect.source?.errorCode, "GOOGLE_RECONNECT");
});

test("only the signed-in dashboard enables Google, not Grok or the work-stop view", () => {
  const source = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  assert.match(source("../app/api/calendar-brief/route.ts"), /request\.cookies\.get\("dcp_access"\).*?!ctx\.user\.is_anonymous/);
  assert.match(source("../lib/server/calendar-brief.ts"), /humanDashboard && includeGoogleWork \? readDashboardGoogleWorkAgenda\(client,owner,w\)/);
  assert.match(source("../app/api/agent/brief/route.ts"), /readCalendarBrief\(owner\.data,service,service\)/);
  assert.doesNotMatch(source("../app/api/agent/brief/route.ts"), /includeGoogleWork|readDashboardGoogleWorkAgenda/);
});
