import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { findControlResources } from "../lib/server/task-search.ts";

const viewer = "11111111-1111-4111-8111-111111111111";

function fixture(reply: (url: URL, init?: RequestInit) => unknown[]) {
  return createClient("https://search-fixture.test", "fixture-publishable", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => Response.json(reply(new URL(String(input)), init)), headers: { Authorization: "Bearer signed-in-fixture" } },
  });
}

test("search by title or private Tag uses the signed-in user and deduplicates overlapping task results", async () => {
  const requested: string[] = [];
  const row = { id: "task-a", title: "Wecare task", visibility: "private" };
  const db = fixture((url, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer signed-in-fixture");
    const q = url.searchParams;
    assert.equal(q.get("limit"), "20");
    if (url.pathname.endsWith("/operating_items")) {
      assert.equal(q.get("item_type"), "neq.client"); requested.push("notes");
      return [{ id: "note-a", item_type: "note", title: "Wecare note" }];
    }
    assert.equal(q.get("deleted_at"), "is.null");
    if (q.has("title")) {
      assert.equal(q.get("title"), "ilike.%Wecare%"); requested.push("titles");
      return [row];
    }
    assert.match(q.get("select") ?? "", /task_tag_assignments!inner\(tag:personal_task_tags!inner\(name\)\)/);
    assert.equal(q.get("matches.user_id"), `eq.${viewer}`);
    assert.equal(q.get("matches.tag.user_id"), `eq.${viewer}`);
    assert.equal(q.get("matches.tag.deleted_at"), "is.null");
    assert.equal(q.get("matches.tag.name"), "ilike.%Wecare%"); requested.push("private tags");
    const matches = [{ tag: { name: "Wecare" } }, { tag: { name: "Wecare" } }];
    return [{ ...row, matches }, { id: "task-b", title: "Other task name", matches }];
  });
  const result = await findControlResources(db, viewer, " Wecare ");
  assert.equal(result.error, null);
  assert.deepEqual(requested.sort(), ["notes", "private tags", "titles"]);
  assert.deepEqual(result.results.map(item => item.id), ["task-a", "task-b", "note-a"]);
  assert.deepEqual((result.results[1] as Record<string, unknown>).matchedTags, ["Wecare"]);
  assert.equal("matches" in result.results[0], false);
});

test("short queries do not hit the DB, and wildcards are escaped on all joined or titled matches", async () => {
  let calls = 0;
  const db = fixture(url => {
    calls++;
    const q = url.searchParams;
    assert.equal(q.get("title") ?? q.get("matches.tag.name"), "ilike.%a\\%\\_\\*\\\\%");
    return [];
  });
  assert.deepEqual(await findControlResources(db, viewer, " a "), { results: [], error: null });
  assert.equal(calls, 0);
  assert.deepEqual(await findControlResources(db, viewer, "a%_*\\"), { results: [], error: null });
  assert.equal(calls, 3);
});

test("恩海居 finds the exact SEC Tag as well as literal title matches", async () => {
  const db = fixture(url => {
    const q = url.searchParams;
    if (q.has("title")) {
      assert.equal(q.get("title"), "ilike.%恩海居%");
      return [];
    }
    assert.equal(q.get("matches.tag.name"), "ilike.SEC");
    return [{ id: "sec-task", title: "Related task", matches: [{ tag: { name: "SEC" } }] }];
  });
  const result = await findControlResources(db, viewer, "恩海居");
  assert.equal(result.error, null);
  assert.deepEqual(result.results.map(row => row.id), ["sec-task"]);
});
