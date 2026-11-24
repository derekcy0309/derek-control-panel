import assert from "node:assert/strict";
import test from "node:test";
import { GOOGLE_WORK_SOURCE, briefWindow, makeCalendarBrief } from "../lib/calendar-brief.ts";
import { listGoogleWorkAgendaEvents } from "../lib/integrations/google-work-agenda.ts";

const now = new Date("2026-11-29T17:30:00Z");
const window = briefWindow(now);
const selectedCalendar = "company-calendar@group.calendar.google.com";
const token = "test-token";
const timed = { start: { dateTime: "2026-11-30T10:00:00+08:00" }, end: { dateTime: "2026-11-30T10:30:00+08:00" } };
const response = (items: unknown[], nextPageToken?: string) => Response.json({ items, nextPageToken });

test("reads only the chosen calendar using a narrow, uncached, no-redirect GET over the HK three-day window", async () => {
  const calendarWithReservedChars = "chosen+calendar?name/work@group.calendar.google.com";
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://www.googleapis.com");
    assert.equal(url.pathname, "/calendar/v3/calendars/" + encodeURIComponent(calendarWithReservedChars) + "/events");
    assert.equal(url.searchParams.get("timeMin"), "2026-11-30T00:00:00+08:00");
    assert.equal(url.searchParams.get("timeMax"), "2026-12-03T00:00:00+08:00");
    assert.equal(url.searchParams.get("timeZone"), "Asia/Hong_Kong");
    assert.equal(url.searchParams.get("singleEvents"), "true");
    assert.equal(url.searchParams.get("showDeleted"), "false");
    assert.match(url.searchParams.get("fields") ?? "", /nextPageToken.*extendedProperties\/private/);
    assert.doesNotMatch(url.searchParams.get("fields") ?? "", /attendees|description|location|organizer|attachments|conference/);
    assert.equal(init?.method, "GET");
    assert.equal(init?.body, undefined);
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token");
    assert.doesNotMatch(String(input), /test-token/);
    return response([]);
  };
  assert.deepEqual(await listGoogleWorkAgendaEvents(token, calendarWithReservedChars, window, { fetch: transport }), { events: [], truncated: false });
});

test("keeps real events with similar titles and drops Dayline sync copies, cancelled and malformed items", async () => {
  const rows = [
    { id: "native-id", summary: "同一個名", status: "tentative", ...timed },
    { id: "replicated", summary: "同一個名", ...timed, extendedProperties: { private: { dcpItemId: "dayline-record" } } },
    { id: "dcp" + "a".repeat(32), summary: "舊同步副本", ...timed },
    { id: "cancelled", summary: "取消", status: "cancelled", ...timed },
    { id: "invalid-date", summary: "日期無效", start: { date: "2026-11-31" }, end: { date: "2026-12-02" } },
    { id: "mixed", start: { date: "2026-11-30" }, end: timed.end },
    { id: "outside", start: { date: "2026-11-28" }, end: { date: "2026-11-30" } },
    { id: "outside-at-end", start: { dateTime: "2026-12-03T00:00:00+08:00" }, end: { dateTime: "2026-12-03T01:00:00+08:00" } },
    { id: "timezone-less", start: { dateTime: "2026-11-30T01:00:00" }, end: timed.end },
    { id: "backwards", start: timed.end, end: timed.start },
    null,
    {},
    100
  ];
  const result = await listGoogleWorkAgendaEvents(token, selectedCalendar, window, { fetch: async () => response(rows) });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].source, GOOGLE_WORK_SOURCE);
  assert.equal(result.events[0].title, "同一個名");
  assert.equal(result.events[0].tentative, true);
  assert.equal(result.events[0].start, "2026-11-30T02:00:00.000Z");
  assert.equal(result.truncated, false);
  assert.doesNotMatch(JSON.stringify(result), /native-id|dayline-record|group.calendar.google.com/);
});

test("redacts sensitive summaries and keeps all-day exclusive ends and timed timezone offsets", async () => {
  const rows = [
    { id: "private", summary: "Private Calendar Title", visibility: "private", ...timed, description: "Private Notes", attendees: [{ email: "private@email.test" }] },
    { id: "confidential", summary: "Confidential Calendar Title", visibility: "confidential", start: { date: "2026-11-29" }, end: { date: "2026-12-02" } },
    { id: "tz", summary: "跨時區 工作", start: { dateTime: "2026-12-01T16:30:00", timeZone: "Europe/London" }, end: { dateTime: "2026-12-01T17:30:00", timeZone: "Europe/London" } }
  ];
  const { events } = await listGoogleWorkAgendaEvents(token, selectedCalendar, window, { fetch: async () => response(rows) });
  assert.deepEqual(events.map(event => event.title), ["私人行程", "私人行程", "跨時區 工作"]);
  assert.equal(events[1].start, "2026-11-29");
  assert.equal(events[1].end, "2026-12-02");
  assert.equal(events[2].start, "2026-12-01T16:30:00.000Z");
  const emailSafe = JSON.stringify(events);
  assert.doesNotMatch(emailSafe, /Private Calendar Title|Confidential Calendar Title|Private Notes|private@email.test/);
  const brief = makeCalendarBrief(events, [], [], now);
  assert.deepEqual(brief.days.map(day => day.events.map(event => event.title)), [
    ["私人行程", "私人行程"], ["私人行程"], ["跨時區 工作"]
  ]);
});

test("follows pagination even on empty pages, deduplicates event IDs and shares one deadline", async () => {
  const calls: { token: string | null; signal: AbortSignal | null | undefined }[] = [];
  const basic = { id: "native", ...timed };
  const transport: typeof fetch = async (input, init) => {
    const pageToken = new URL(String(input)).searchParams.get("pageToken");
    calls.push({ token: pageToken, signal: init?.signal });
    if (!pageToken) return response([], "second-page");
    if (pageToken === "second-page") return response([basic], "last-page");
    return response([basic]);
  };
  const result = await listGoogleWorkAgendaEvents(token, selectedCalendar, window, { fetch: transport });
  assert.deepEqual(calls.map(call => call.token), [null, "second-page", "last-page"]);
  assert.ok(calls[0].signal);
  assert.ok(calls.every(call => call.signal === calls[0].signal));
  assert.equal(result.events.length, 1);
  assert.equal(result.truncated, false);
});

test("bounds provider pagination and marks partial results visibly incomplete", async () => {
  let calls = 0;
  const transport: typeof fetch = async () => response([], "next" + (++calls));
  const result = await listGoogleWorkAgendaEvents(token, selectedCalendar, window, { fetch: transport });
  assert.equal(calls, 3);
  assert.deepEqual(result, { events: [], truncated: true });
  let largePage = 0;
  const largeResult = await listGoogleWorkAgendaEvents(token, selectedCalendar, window, {
    fetch: async () => response(Array.from({ length: 100 }, (_, index) => ({ id: String(largePage * 100 + index), ...timed })), "next" + (++largePage))
  });
  assert.equal(largeResult.events.length, 200);
  assert.equal(largeResult.truncated, true);
});

test("maps provider failures to safe codes without exposing Google response data", async () => {
  const cases: [number, unknown, string][] = [
    [401, { error: "private account debug" }, "GOOGLE_RECONNECT"],
    [403, { error: "private permission debug" }, "GOOGLE_RECONNECT"],
    [403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }, "GOOGLE_UNAVAILABLE"],
    [404, { error: "private calendar address" }, "GOOGLE_RECONNECT"],
    [429, { error: "private calendar rate" }, "GOOGLE_UNAVAILABLE"],
    [503, { error: "private server error" }, "GOOGLE_UNAVAILABLE"],
    [200, { items: "malformed private provider payload" }, "GOOGLE_UNAVAILABLE"]
  ];
  for (const [status, body, message] of cases) {
    await assert.rejects(listGoogleWorkAgendaEvents(token, selectedCalendar, window, {
      fetch: async () => Response.json(body, { status })
    }), { message });
  }
  await assert.rejects(listGoogleWorkAgendaEvents(token, selectedCalendar, window, {
    fetch: async () => { throw new Error("sensitive error before response"); }
  }), { message: "GOOGLE_UNAVAILABLE" });
  await assert.rejects(listGoogleWorkAgendaEvents(token, "..", window, {
    fetch: async () => { assert.fail("must never contact provider for an invalid path"); }
  }), { message: "GOOGLE_RECONNECT" });
});
