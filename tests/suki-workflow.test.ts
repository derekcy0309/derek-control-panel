import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSukiFollowupSummary, taskFollowupCategories } from "../lib/suki-followups.ts";
import { createWrittenReply, replyTemplates, summarizeWrittenMessage } from "../lib/written-communication.ts";
import type { Task } from "../lib/types.ts";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const dashboard = readFileSync(resolve(here, "../components/RoleDailyDashboard.tsx"), "utf8");
const handoff = readFileSync(resolve(here, "../components/items/TaskHandoffControls.tsx"), "utf8");
const migration = readFileSync(resolve(here, "../supabase/migrations/20260804160000_suki_workflow_followups.sql"), "utf8").toLowerCase();
const rollback = readFileSync(resolve(here, "../supabase/migrations/20260804160000_suki_workflow_followups.rollback.sql"), "utf8").toLowerCase();

test("six written templates work without an external AI service", () => {
  assert.equal(replyTemplates.length, 6);
  assert.deepEqual(replyTemplates.map((template) => template.label), [
    "確認預約", "等待病人資料", "護士安排中", "物資確認", "付款提醒", "更改服務時間"
  ]);
  const reply = createWrittenReply({
    templateId: "service_time_change",
    recipient: "陳先生",
    timing: "星期五下午三時",
    extra: "請以文字回覆"
  });
  assert.match(reply.subject, /服務時間/);
  assert.match(reply.body, /陳先生你好/);
  assert.match(reply.body, /收到確認前/);
  assert.match(reply.body, /星期五下午三時/);
});

test("incoming text is summarized locally with deterministic limits", () => {
  const summary = summarizeWrittenMessage("星期五出院。請確認護士安排！物資仍欠 dressing pack。第四句不應放入摘要。 ");
  assert.match(summary, /星期五出院/);
  assert.match(summary, /護士安排/);
  assert.match(summary, /dressing pack/);
  assert.doesNotMatch(summary, /第四句/);
  assert.ok(summary.length <= 280);
});

test("Suki follow-ups combine client, RN, materials, payment and overdue work", () => {
  const task = {
    id: "00000000-0000-4000-8000-000000000001",
    title: "跟進發票付款及護士安排",
    description: null,
    next_action: "向家屬確認物資",
    due_date: "2026-08-01",
    follow_up_date: "2026-08-02",
    planned_date: null,
    status: "waiting",
    task_type: "rn_coordination",
    rn_required: true,
    client_update_required: true,
    materials_required: "PICC dressing pack",
    deleted_at: null,
    archived_at: null
  } as Task;
  assert.deepEqual(taskFollowupCategories(task, "2026-08-04"), ["overdue", "family_reply", "rn", "materials", "payment"]);
  const summary = buildSukiFollowupSummary([task], "2026-08-04");
  assert.equal(summary.totalTasks, 1);
  assert.equal(summary.counts.rn, 1);
  assert.equal(summary.counts.payment, 1);
});

test("quiet mode hides ordinary top tasks and keeps one combined follow-up panel", () => {
  assert.match(dashboard, /quietActive[\s\S]*topCandidates\.filter\(trulyUrgent\)/);
  assert.match(dashboard, /今日綜合跟進/);
  assert.match(dashboard, /WrittenCommunicationAssistant/);
  assert.match(dashboard, /slice\(0, 3\)/);
});

test("an active handler can transfer only to an existing participant with an audit chain", () => {
  assert.match(handoff, /"transfer"/);
  assert.match(handoff, /handoff_transfer/);
  assert.match(migration, /participant_profiles\(\)/);
  assert.match(migration, /parent_assignment_id/);
  assert.match(migration, /task_handoff_notes/);
  assert.match(migration, /grant execute on function public\.transfer_task_handoff/);
  assert.match(rollback, /drop function if exists public\.transfer_task_handoff/);
});

test("daily digest remains idempotent and includes payment follow-ups", () => {
  assert.match(migration, /unique per user and local digest date/);
  assert.match(migration, /on conflict \(user_id, digest_date\)/);
  assert.match(migration, /from public\.transactions cashflow/);
  assert.match(migration, /cashflow\.status in \('unpaid','problem'\)/);
  assert.match(migration, /followupcategory/);
  assert.match(migration, /notification_dispatch_authorized/);
});
