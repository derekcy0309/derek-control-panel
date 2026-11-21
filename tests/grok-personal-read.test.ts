import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { BriefEvent } from "../lib/calendar-brief.ts";
import { grokPersonalReadCatalog, grokPersonalReadQuery, projectGrokPersonalCalendar, readGrokPersonalRows } from "../lib/server/grok-personal-read.ts";

const own = "11111111-1111-4111-8111-111111111111";
const selfTask = "22222222-2222-4222-8222-222222222222";
const blockedTask = "33333333-3333-4333-8333-333333333333";
const nextTask = "44444444-4444-4444-8444-444444444444";
const params = (s: string) => grokPersonalReadQuery(new URLSearchParams(s));

function fixture(handle: (request: Request) => Promise<Response> | Response) {
  return createClient("http://fixture.local", "fixture-service", {
    global: { fetch: (input, init) => Promise.resolve(handle(new Request(input, init))) }, auth: { autoRefreshToken: false, persistSession: false },
  });
}

test("trusted Grok only accepts fixed datasets, bounded limits and a valid HK month", () => {
  assert.deepEqual(params(""), { dataset: "catalog" });
  assert.equal(grokPersonalReadCatalog.find(item => item.dataset === "icloud")?.month, "required");
  for (const invalid of [
    "owner_id=foreign", "dataset=tasks&owner=foreign", "dataset=tasks&user_id=foreign", "dataset=tasks&table=auth.users",
    "dataset=tasks&select=*", "dataset=tasks&dataset=notes", "dataset=icloud", "dataset=icloud&month=2200-01",
    "dataset=icloud&month=1899-01", "dataset=icloud&month=2026-13", "dataset=icloud&month=2026-02&month=2026-03",
    "dataset=icloud&month=2026-02&until=2028-01-01", "dataset=icloud&month=2026-02&limit=2", "dataset=icloud&month=2026-02&offset=0",
    "dataset=notes&month=2026-02", "dataset=__proto__", "dataset=calendar&limit=31", "dataset=tasks&limit=0", "dataset=tasks&offset=10000",
  ]) assert.equal(params(invalid), null, invalid);
  const window = params("dataset=icloud&month=2026-12");
  assert.deepEqual(window, { dataset: "icloud", window: { month: "2026-12", from: "2026-12-01", until: "2027-01-01", start: "2026-12-01T00:00:00+08:00", end: "2027-01-01T00:00:00+08:00" } });
});

test("workspace query includes strict owner privacy and denies a row with an active share before projecting fields", async () => {
  const parsed = params("dataset=tasks&month=2026-11&limit=2&offset=3");
  assert.ok(parsed?.dataset === "tasks");
  let aclCalls = 0;
  const client = fixture(async request => {
    assert.equal(request.headers.get("authorization"), "Bearer fixture-service");
    const url = new URL(request.url);
    if (url.pathname.endsWith("/rpc/grok_personal_unshared_ids")) {
      aclCalls++;
      assert.deepEqual(await request.json(), { p_owner_id: own, p_kind: "tasks", p_record_ids: [selfTask, blockedTask] });
      return Response.json([selfTask]);
    }
    assert.equal(url.pathname, "/rest/v1/tasks");
    assert.equal(url.searchParams.get("owner_id"), `eq.${own}`);
    assert.equal(url.searchParams.get("created_by_id"), `eq.${own}`);
    assert.equal(url.searchParams.get("visibility"), "eq.private");
    assert.equal(url.searchParams.get("household_id"), "is.null");
    assert.equal(url.searchParams.get("or"), `(assignee_id.is.null,assignee_id.eq.${own})`);
    assert.equal(url.searchParams.get("archived_at"), "is.null");
    assert.equal(url.searchParams.get("deleted_at"), "is.null");
    assert.equal(url.searchParams.get("order"), "id.asc");
    assert.equal(url.searchParams.get("offset"), "3");
    assert.equal(url.searchParams.get("limit"), "3");
    assert.deepEqual(url.searchParams.getAll("due_date"), ["gte.2026-11-01", "lt.2026-12-01"]);
    return Response.json([
      { id: selfTask, title: "Owned", description: "a".repeat(4_100), owner_id: "unnecessary", metadata: "SECRET", assignee_id: "person-private" },
      { id: blockedTask, title: "Wrong audience" }, { id: nextTask, title: "Next page" },
    ]);
  });
  const result = await readGrokPersonalRows(client, own, parsed);
  assert.equal(result.nextOffset, 5);
  assert.equal(aclCalls, 1);
  assert.deepEqual(result.items, [{ id: selfTask, title: "Owned", description: "a".repeat(4_000), textTruncated: true }]);
  assert.doesNotMatch(JSON.stringify(result), /Wrong audience|SECRET|person-private|unnecessary|33333333/);
});

test("an unavailable ACL check fails closed instead of returning candidate workspace rows", async () => {
  const parsed = params("dataset=notes");
  assert.ok(parsed?.dataset === "notes");
  const client = fixture(request => new URL(request.url).pathname.includes("/rpc/")
    ? Response.json({ code: "unavailable" }, { status: 503 })
    : Response.json([{ id: selfTask, title: "Do not release" }]));
  await assert.rejects(readGrokPersonalRows(client, own, parsed), /GROK_PERSONAL_ACL_FAILED/);
});

test("finance reads only owner's personal books and omits payment details, supporting settled and legacy months", async () => {
  const parsed = params("dataset=finance_transactions&month=2026-02");
  assert.ok(parsed?.dataset === "finance_transactions");
  const client = fixture(request => {
    const url = new URL(request.url);
    assert.equal(url.pathname, "/rest/v1/transactions");
    assert.equal(url.searchParams.get("user_id"), `eq.${own}`);
    assert.equal(url.searchParams.get("scope"), "eq.home");
    assert.match(url.searchParams.get("or") ?? "", /payment_month\.gte\.2026-02-01.*actual_date\.gte\.2026-02-01.*expected_date\.gte\.2026-02-01/);
    assert.doesNotMatch(url.searchParams.get("select") ?? "", /payment_method|proof_url|notes/);
    return Response.json([{ id: selfTask, type: "expense", item: "Private fixture expense", amount: 30, proof_url: "https://example.test/private-signed-href" }]);
  });
  assert.deepEqual((await readGrokPersonalRows(client, own, parsed)).items, [{ id: selfTask, type: "expense", item: "Private fixture expense", amount: 30 }]);
});

test("personal admin exposes only own health, document and vehicle summaries", async () => {
  const parsed = params("dataset=personal_records&month=2026-02");
  assert.ok(parsed?.dataset === "personal_records");
  const client = fixture(async request => {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/grok_personal_unshared_ids")) {
      assert.deepEqual(await request.json(), { p_owner_id: own, p_kind: "personal_records", p_record_ids: [selfTask] });
      return Response.json([selfTask]);
    }
    assert.equal(url.pathname, "/rest/v1/operating_items");
    assert.equal(url.searchParams.get("owner_id"), `eq.${own}`);
    assert.equal(url.searchParams.get("area"), "eq.personal");
    assert.equal(url.searchParams.get("item_type"), "in.(health,document,vehicle)");
    assert.equal(url.searchParams.get("select"), "id,title,item_type,status,due_date,updated_at");
    return Response.json([{ id: selfTask, title: "Renewal", item_type: "document", metadata: { identifier: "private-number" } }]);
  });
  assert.deepEqual((await readGrokPersonalRows(client, own, parsed)).items, [{ id: selfTask, title: "Renewal", item_type: "document" }]);
});

test("iCloud returns selected month overlaps only, no CalDAV IDs or provider metadata", () => {
  const result = params("dataset=icloud&month=2026-12");
  assert.ok(result?.dataset === "icloud");
  const sample = (start: string, end: string, title: string, allDay = false): BriefEvent => ({ id: "private-provider-id", uid: "calendar-user@example.test", source: "Apple", start, end, title, allDay });
  const events = [
    sample("2026-11-29", "2026-12-01", "Before", true), sample("2026-11-30", "2026-12-03", "Overlapping all-day", true),
    sample("2026-11-30T16:00:00Z", "2026-11-30T16:00:00Z", "Point at Hong Kong midnight"),
    sample("2026-12-31T16:00:00Z", "2026-12-31T17:00:00Z", "After Hong Kong midnight"),
  ];
  const projected = projectGrokPersonalCalendar({ month: "2026-12", from: "2026-11-28", until: "2027-01-05", events, source: { label: "Private account", state: "fresh", lastSync: null }, truncated: false }, result.window);
  assert.deepEqual(projected.items.map(event => event.title), ["Overlapping all-day", "Point at Hong Kong midnight"]);
  assert.doesNotMatch(JSON.stringify(projected), /calendar-user@example|Private account|private-provider-id/);
});
