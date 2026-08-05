import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSukiFollowupSummary, taskFollowupCategories } from "../lib/suki-followups.ts";
import { personalTaskTemplates } from "../lib/personal-task-templates.ts";
import type { Task } from "../lib/types.ts";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const read = (path: string) => readFileSync(resolve(here, `../${path}`), "utf8");

test("personal work templates cover the requested common tasks without external AI", () => {
  assert.deepEqual(personalTaskTemplates.map((template) => template.label), [
    "會議後跟進", "等待文件", "等待別人決定", "每週行政工作", "每月財務檢查", "社交媒體出 Post", "個人學習及進修"
  ]);
  assert.doesNotMatch(read("lib/personal-task-templates.ts"), /openai|anthropic|patient|clinical/i);
});

test("Suki summary stays personal, neutral and bounded", () => {
  const task = {
    id: "00000000-0000-4000-8000-000000000001",
    title: "等待文件覆核",
    description: null,
    next_action: "星期三再問 Amigo",
    due_date: "2026-08-01",
    follow_up_date: "2026-08-02",
    planned_date: null,
    status: "waiting",
    deleted_at: null,
    archived_at: null
  } as Task;
  assert.deepEqual(taskFollowupCategories(task, "2026-08-04"), ["overdue", "waiting"]);
  const summary = buildSukiFollowupSummary([task], "2026-08-04");
  assert.equal(summary.totalTasks, 1);
  assert.equal(summary.counts.waiting, 1);
  assert.doesNotMatch(read("components/RoleDailyDashboard.tsx"), /case_code|rn_required|materials_required|client_update_required/);
});

test("home cards are progressive and waiting work cannot occupy the top three", () => {
  const dashboard = read("components/RoleDailyDashboard.tsx");
  assert.match(dashboard, /filter\(todayEligible\)\.slice\(0, 3\)/);
  assert.match(dashboard, /!\["waiting", "blocked"\]\.includes\(task\.status\)/);
  assert.match(dashboard, /下一步：/);
  assert.match(dashboard, /截止：/);
  assert.match(dashboard, /優先：/);
  assert.doesNotMatch(dashboard, /cashflowHint|WrittenCommunicationAssistant/);
});

test("task list cards keep key information visible and disclose details on demand", () => {
  const taskCard = read("components/items/TaskCard.tsx");
  const detailPage = read("app/tasks/[id]/page.tsx");
  assert.match(taskCard, /useState\(prominent\)/);
  assert.match(taskCard, /aria-expanded=\{expanded\}/);
  assert.match(taskCard, /到期：\{formatDate\(task\.due_date\)\}/);
  assert.match(taskCard, /展開詳情/);
  assert.match(taskCard, /收起詳情/);
  assert.match(taskCard, /\{expanded \? \(/);
  assert.match(detailPage, /prominent/);
});

test("PWA metadata describes personal work only", () => {
  const manifest = read("app/manifest.ts");
  const layout = read("app/layout.tsx");
  assert.match(manifest, /個人工作管理系統/);
  assert.match(layout, /個人工作管理系統/);
  assert.doesNotMatch(manifest, /公司日常作業系統|\"business\"/);
});

test("quick add keeps three primary inputs, templates and session draft recovery", () => {
  const form = read("components/forms/TaskForm.tsx");
  assert.match(form, /要做甚麼/);
  assert.match(form, /何時完成（可留空）/);
  assert.match(form, /負責人/);
  assert.match(form, /personalTaskTemplates/);
  assert.match(form, /sessionStorage/);
});

test("handoff supports accept, clarification, reschedule and transfer", () => {
  const handoff = read("components/items/TaskHandoffControls.tsx");
  assert.match(handoff, /接受跟進/);
  assert.match(handoff, /要求補充/);
  assert.match(handoff, /建議改期/);
  assert.match(handoff, /handoff_transfer/);
  assert.doesNotMatch(handoff, /更新個案進度|個案去向|完全結案/);
});

test("personal work queue migration is additive, indexed and leaves finance out of the digest", () => {
  const migration = read("supabase/migrations/20260804200000_personal_work_queue.sql").toLowerCase();
  const rollback = read("supabase/migrations/20260804200000_personal_work_queue.rollback.sql").toLowerCase();
  assert.match(migration, /add column if not exists waiting_for/);
  assert.match(migration, /add column if not exists waiting_on/);
  assert.match(migration, /tasks_waiting_follow_up_idx/);
  assert.match(migration, /notification_dispatch_authorized/);
  assert.match(migration, /on conflict \(user_id, digest_date\)/);
  assert.doesNotMatch(migration, /from public\.transactions/);
  assert.match(migration, /revoke all on function public\.claim_due_email_digests\([\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.claim_due_email_digests\([\s\S]*to service_role/);
  assert.doesNotMatch(migration, /to anon, service_role/);
  assert.match(read("app/api/cron/due-email/route.ts"), /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(migration, /drop table|delete from/);
  assert.match(rollback, /personal_work_queue_rollback_requires_waiting_data_export/);
});
