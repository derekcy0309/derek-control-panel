import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isLikelyDuplicate, parseHandoffText } from "../lib/handoff-parser.ts";
import { resolveWorkspaceRole } from "../lib/workspace-role.ts";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("Cantonese handoff becomes an editable, bounded work preview", () => {
  const preview = parseHandoffText({
    text: "李太星期五出院，Suki問醫院攞antibiotic schedule，安排星期五晚RN，準備PICC dressing pack，抗生素時間要我確認。",
    currentUserId: "11111111-1111-4111-8111-111111111111",
    currentUserName: "Derek",
    participants: [
      { user_id: "11111111-1111-4111-8111-111111111111", display_name: "Derek" },
      { user_id: "22222222-2222-4222-8222-222222222222", display_name: "Suki" }
    ],
    today: "2026-08-04"
  });
  assert.equal(preview.caseCode, "李太");
  assert.equal(preview.ownerName, "Suki");
  assert.equal(preview.ownerId, "22222222-2222-4222-8222-222222222222");
  assert.equal(preview.dueDate, "2026-08-07");
  assert.equal(preview.rnRequired, true);
  assert.equal(preview.materialsRequired, "PICC dressing pack");
  assert.equal(preview.needsDecisionFromName, "Derek");
  assert.equal(preview.needsDecisionFromId, "11111111-1111-4111-8111-111111111111");
});

test("incomplete handoff remains usable without inventing a deadline", () => {
  const preview = parseHandoffText({
    text: "幫手跟進醫院資料",
    currentUserId: "11111111-1111-4111-8111-111111111111",
    currentUserName: "Derek",
    participants: [],
    today: "2026-08-04"
  });
  assert.equal(preview.dueDate, "");
  assert.equal(preview.ownerId, "11111111-1111-4111-8111-111111111111");
  assert.ok(preview.title);
  assert.ok(preview.nextAction);
});

test("duplicate guard uses title or case plus date and never submits silently", () => {
  assert.equal(isLikelyDuplicate(
    { title: "問醫院攞 schedule", caseCode: "C-102", dueDate: "2026-08-07" },
    [{ title: "問醫院攞 schedule", case_code: "C-102", due_date: "2026-08-07" }]
  ), true);
  const form = read("components/VoiceHandoffForm.tsx");
  assert.match(form, /duplicate && !allowDuplicate/);
  assert.match(form, /確認並建立任務/);
  assert.match(form, /SpeechRecognition/);
  assert.doesNotMatch(form, /MediaRecorder|getUserMedia/);
});

test("role personalization is a display preference, not an authorization role", () => {
  assert.equal(resolveWorkspaceRole({ email: "derekcy0309@gmail.com", configured: "general" }), "derek");
  assert.equal(resolveWorkspaceRole({ email: "love29suki@gmail.com", configured: "general" }), "suki");
  assert.equal(resolveWorkspaceRole({ displayName: "Amigo", configured: "general" }), "amigo");
  const settings = read("app/settings/page.tsx");
  assert.match(settings, /只調整首頁內容，不會改變管理員或資料權限/);
  assert.doesNotMatch(read("app/api/control/route.ts"), /workspaceRole.*is_admin/);
});

test("home is progressive, caps the primary list at three and keeps advanced tools", () => {
  const dashboard = read("components/RoleDailyDashboard.tsx");
  const home = read("app/page.tsx");
  assert.match(dashboard, /slice\(0, 3\)/);
  assert.match(dashboard, /今日三項主要任務/);
  assert.match(dashboard, /真正緊急或已逾期/);
  assert.match(dashboard, /新交接/);
  assert.match(dashboard, /等待本人決定或確認/);
  assert.match(home, /重新安排或查看完整 Today 工具/);
  assert.match(home, /RoleDailyDashboard/);
  assert.match(home, /AIDailyPlanner/);
  assert.match(home, /TodayTaskManager/);
});

test("migration is additive, indexed, least-privilege and has an explicit rollback", () => {
  const migration = read("supabase/migrations/20260804100000_three_role_daily_workflow.sql");
  const rollback = read("supabase/migrations/20260804100000_three_role_daily_workflow.rollback.sql");
  assert.match(migration, /alter table public\.tasks[\s\S]*add column if not exists case_code/);
  assert.match(migration, /tasks_owner_client_request_unique/);
  assert.match(migration, /tasks_open_decision_owner_idx/);
  assert.match(migration, /actor = old\.needs_decision_from_id/);
  assert.match(migration, /previous_actor is not null[\s\S]*'due_date','follow_up_date'/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /revoke all on function public\.set_current_user_quiet_mode/);
  assert.match(migration, /grant execute on function public\.set_current_user_quiet_mode[\s\S]*to authenticated/);
  assert.match(migration, /urgent_safety[\s\S]*safety_impact and task\.risk = 'high'/);
  assert.doesNotMatch(migration, /drop table public\.(tasks|transactions|user_profiles)/);
  assert.match(rollback, /drop function if exists public\.set_current_user_quiet_mode/);
  assert.match(rollback, /drop column if exists workspace_role/);
});

test("task detail, decision confirmation, quiet mode and audit stay server-authorized", () => {
  const api = read("app/api/control/route.ts");
  const detail = read("app/tasks/[id]/page.tsx");
  assert.match(api, /view === "task_detail"/);
  assert.match(api, /client_request_id/);
  assert.match(api, /participant_profiles/);
  assert.match(api, /only|只有被指定決定的人可以確認/);
  assert.match(api, /decision_confirmed/);
  assert.match(api, /set_current_user_quiet_mode/);
  assert.match(detail, /loadTaskDetail/);
  assert.match(detail, /detailLink=\{false\}/);
});

test("drafts are versioned, session-only and cleared on sign-out", () => {
  const voice = read("components/VoiceHandoffForm.tsx");
  const taskForm = read("components/forms/TaskForm.tsx");
  const shell = read("components/AppShell.tsx");
  assert.match(voice, /sessionStorage/);
  assert.match(voice, /voice-handoff-draft:v1/);
  assert.match(taskForm, /task-form-draft:v1/);
  assert.match(shell, /voice-handoff-draft:v1/);
  assert.match(shell, /task-form-draft:v1/);
  assert.doesNotMatch(voice, /localStorage/);
});
