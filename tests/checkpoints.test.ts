import test from "node:test";
import assert from "node:assert/strict";
import {
  checkpointFormFromRecord,
  emptyCheckpointForm,
  hasCheckpointContent,
  parseCheckpointResources
} from "../lib/checkpoints.ts";

test("checkpoint content requires a meaningful restart field", () => {
  assert.equal(hasCheckpointContent(emptyCheckpointForm()), false);
  assert.equal(hasCheckpointContent({ ...emptyCheckpointForm(), resourceLinksText: "https://example.com" }), false);
  assert.equal(hasCheckpointContent({ ...emptyCheckpointForm(), currentPosition: "做到第二頁" }), true);
  assert.equal(hasCheckpointContent({ ...emptyCheckpointForm(), nextMinimumStep: "打開報價表" }), true);
});

test("checkpoint resources accept labelled HTTPS links and preserve order", () => {
  const result = parseCheckpointResources("報價表 | https://example.com/quote\nhttps://supabase.com/dashboard");
  assert.equal(result.error, null);
  assert.deepEqual(result.resources, [
    { label: "報價表", url: "https://example.com/quote" },
    { label: "supabase.com", url: "https://supabase.com/dashboard" }
  ]);
});

test("checkpoint resources reject insecure, malformed and excessive links", () => {
  assert.match(parseCheckpointResources("http://example.com").error ?? "", /https/i);
  assert.match(parseCheckpointResources("not a url").error ?? "", /https/i);
  const eleven = Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`).join("\n");
  assert.match(parseCheckpointResources(eleven).error ?? "", /10/);
});

test("draft records restore all editable fields", () => {
  const form = checkpointFormFromRecord({
    id: "00000000-0000-4000-8000-000000000001",
    task_id: "00000000-0000-4000-8000-000000000002",
    author_id: "00000000-0000-4000-8000-000000000003",
    state: "draft",
    completed_summary: "已完成核對",
    current_position: "第二頁",
    next_minimum_step: "核對第三頁",
    resource_links: [{ label: "表格", url: "https://example.com/sheet" }],
    blocked_reason: "等回覆",
    last_worked_at: "2026-07-24T10:00:00.000Z",
    created_at: "2026-07-24T10:00:00.000Z",
    updated_at: "2026-07-24T10:00:00.000Z"
  });
  assert.equal(form.completedSummary, "已完成核對");
  assert.equal(form.currentPosition, "第二頁");
  assert.equal(form.nextMinimumStep, "核對第三頁");
  assert.equal(form.resourceLinksText, "表格 | https://example.com/sheet");
  assert.equal(form.blockedReason, "等回覆");
});
