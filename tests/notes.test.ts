import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clearNoteDrafts, filterNotes, noteCategories, noteCategory, noteDraftKey, noteMetadata, validateNoteInput } from "../lib/notes.ts";
import type { OperatingItem } from "../lib/types.ts";

const item: OperatingItem = {
  id: "n1", item_type: "note", title: "汽車保養資料", description: "上次換車胎的型號",
  metadata: { noteCategory: "車輛", originalSource: "inbox" }, status: "completed", area: "personal",
  owner_id: "derek", created_by_id: "derek", assignee_id: null, visibility: "private", sensitive: true,
  archived_at: null, due_date: "2020-01-01", next_action: "舊欄位", last_progress_at: null,
  created_at: "2026-10-01T01:00:00Z", updated_at: "2026-10-08T01:00:00Z"
};

test("notes have the requested categories and support short custom remarks", () => {
  for (const category of ["車輛", "個人財務", "公司", "工作", "個人"]) assert.ok(noteCategories.some((value) => value === category));
  assert.equal(validateNoteInput({ title: "記事", description: "", category: "  興趣  " }), null);
  assert.deepEqual(noteMetadata({}, "  興趣  "), { noteCategory: "興趣" });
  assert.equal(noteCategory({ metadata: { noteCategory: 42 } }), "");
});

test("note input validation rejects invalid types and never silently truncates content", () => {
  for (const value of [undefined, "", "  ", {}, "a".repeat(501)]) assert.ok(validateNoteInput({ title: value, description: "", category: "" }));
  for (const value of [{}, "a".repeat(10001)]) assert.ok(validateNoteInput({ title: "標題", description: value, category: "" }));
  for (const value of [[], {}, "a".repeat(41)]) assert.ok(validateNoteInput({ title: "標題", description: "", category: value }));
  assert.equal(validateNoteInput({ title: "標題", description: null, category: null }), null);
});

test("classification only changes one metadata key and preserves original sources", () => {
  const metadata = noteMetadata(item.metadata, "個人財務");
  assert.deepEqual(metadata, { noteCategory: "個人財務", originalSource: "inbox" });
  assert.deepEqual(noteMetadata(metadata, ""), { originalSource: "inbox" });
  assert.equal(item.metadata.noteCategory, "車輛");
  assert.equal(item.due_date, "2020-01-01");
});

test("notes are searched by title, content and category, not legacy workflow status", () => {
  const items = [item, { ...item, id: "n2", metadata: {}, updated_at: "2026-10-08T02:00:00Z" }, { ...item, id: "archived", archived_at: "2026-10-08" }, { ...item, id: "other", item_type: "vehicle" }];
  assert.deepEqual(filterNotes(items).map((value) => value.id), ["n2", "n1"]);
  assert.deepEqual(filterNotes(items, "車胎", "車輛").map((value) => value.id), ["n1"]);
  assert.deepEqual(filterNotes(items, "", "__uncategorized").map((value) => value.id), ["n2"]);
  assert.deepEqual(filterNotes(items, "無結果"), []);
});

test("note drafts are account-scoped and signout removes only the current account drafts", () => {
  const keys = [noteDraftKey("derek"), noteDraftKey("derek", "n1"), noteDraftKey("suki"), "other"];
  clearNoteDrafts({ get length() { return keys.length; }, key: (i) => keys[i] ?? null, removeItem: (key) => { keys.splice(keys.indexOf(key), 1); } }, "derek");
  assert.deepEqual(keys, [noteDraftKey("suki"), "other"]);
  assert.match(readFileSync("components/AppShell.tsx", "utf8"), /clearNoteDrafts\(sessionStorage, currentUserId\)/);
});

test("note editor uses existing item API and never submits hidden task fields", () => {
  const editor = readFileSync("components/notes/NoteEditor.tsx", "utf8");
  for (const forbidden of [/DueDatePicker/, /type="date"/, /name="status"/, /due_date:/, /next_action:/, /visibility:/, /urgency/i]) assert.doesNotMatch(editor, forbidden);
  assert.match(editor, /"update_item", \{ id: item.id, noteCategory: form.category.trim\(\), changes: fields \}/);
  assert.match(editor, /"create_item"/);
  assert.match(editor, /itemType: "note", area: "personal", sensitive: true/);
  assert.match(editor, /inFlight.current/);
  assert.match(editor, /sessionStorage.setItem/);
  assert.match(editor, /role="alert"/);
});

test("server keeps new notes private and merges category into existing metadata", () => {
  const api = readFileSync("app/api/control/route.ts", "utf8");
  const create = api.slice(api.indexOf("async function createOperatingItem"), api.indexOf("async function updateOperatingItem"));
  assert.match(create, /isNote \? "personal"/);
  assert.match(create, /due_date: isNote \? null/);
  assert.match(create, /next_action: isNote \? null/);
  assert.match(create, /validateNoteInput/);
  const update = api.slice(api.indexOf("async function updateOperatingItem"), api.indexOf("async function shareResource"));
  assert.match(update, /if \(!owner\) return jsonError/);
  assert.match(update, /noteMetadata\(objectValue\(existing.data.metadata\)/);
  assert.match(update, /recordActivity/);
});
