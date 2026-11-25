import assert from "node:assert/strict";
import test from "node:test";
import { handoffDate, handoffsByTask, handoffSummary } from "../lib/handoff-summary.ts";
import type { Assignment, Task } from "../lib/types.ts";

const people = { currentUser: { id: "self" }, participants: [{ user_id: "recipient", display_name: "Suki" }] };
const work = { id: "work", owner_id: "self", user_id: "self", assignee_id: null, status: "waiting", follow_up_date: "2026-12-02" } satisfies Partial<Task>;
const base = { id: "one", resource_type: "task", resource_id: "work", assigned_by_id: "self", assigned_to_id: "recipient", created_at: "2026-11-25T10:00:00Z", status: "pending_acceptance", proposed_date: null } satisfies Partial<Assignment>;
type Row = Parameters<typeof handoffSummary>[2][number];
const results = (...rows: Row[]) => handoffSummary(work.id, work, rows, people);

test("收悉與接受是不同狀態；接受前不稱接收人為已接手", () => {
  assert.match(results(base).lines[0].state, /尚未確認收悉/);
  assert.match(results({ ...base, acknowledged_at: base.created_at }).lines[0].state, /已確認收悉，尚未接受/);
  assert.equal(results({ ...base, status: "accepted" }).lines[0].next, "由Suki跟進");
});
test("要求資料、提議改期與婉拒均指出等待交辦人，而非接收人", () => {
  assert.equal(results({ ...base, status: "clarification_requested" }).lines[0].next, "待你補充資料");
  const proposal = results({ ...base, status: "alternative_date_proposed", proposed_date: "2026-12-10" });
  assert.equal(proposal.lines[0].next, "待你確認新日期");
  assert.equal(proposal.lines[0].proposedDate, "2026-12-10");
  assert.equal(proposal.followUp, work.follow_up_date);
  assert.equal(results({ ...base, status: "declined" }).lines[0].next, "由你重新安排");
});
test("等候期限以香港日期另列，不代替下次跟進日期", () => {
  const state = handoffSummary("work", { ...work, follow_up_date: null }, [{ ...base, status: "waiting", waiting_until: "2026-11-25T20:00:00Z" }], people);
  assert.equal(state.lines[0].waitingUntil, "2026-11-26");
  assert.equal(state.followUp, null);
  assert.equal(handoffDate("not a date"), null);
});
test("交還後由上一手繼續，同一任務多位跟進人不互相覆蓋；新完成的舊段不蓋過有效紀錄", () => {
  const prior: Row = { ...base, status: "returned" };
  const active: Row = { ...base, id: "two", assigned_to_id: "self", assigned_by_id: "recipient", status: "in_progress", parent_assignment_id: "one", handoff_sequence: 2 };
  const other: Row = { ...base, id: "three", status: "accepted" };
  const newerTerminal: Row = { ...base, id: "four", status: "completed", created_at: "2026-11-26T00:00:00Z" };
  const state = results(prior, other, active, newerTerminal);
  assert.deepEqual(state.lines.map(l => [l.state, l.next]), [["已交回上一位負責人", "由你跟進"], ["已接受交接", "由Suki跟進"]]);
  assert.equal(results(prior).lines[0].next, "由你繼續跟進");
  assert.equal(results(newerTerminal).lines[0].state, "此段交接已完成");
});
test("整項工作完成或取消後不再要求回覆；結案不等於完成某段交接", () => {
  for (const status of ["done", "cancelled"] as const) {
    const state = handoffSummary("work", { ...work, status }, [base], people);
    assert.equal(state.lines[0].next, "毋須跟進");
    assert.equal(state.followUp, null);
  }
  assert.equal(results({ ...base, status: "closed" }).lines[0].state, "已結案");
});
test("只使用當前任務已載入的資料；未知人士不顯示其他帳戶代號或電郵，亦不當成自己", () => {
  const hidden = { ...base, resource_id: "other", assigned_to_id: "private-id", status: "closed" } as const;
  const operating = { ...base, resource_type: "operating_item" } as const;
  assert.deepEqual([...handoffsByTask([hidden, operating, base]).keys()], ["other", "work"]);
  const state = handoffSummary("work", { ...work, id: "other" }, [hidden, operating, { ...base, assigned_to_id: "private-id" }], people);
  assert.equal(state.lines.length, 1);
  assert.equal(state.lines[0].next, "待接收人回覆交接");
  assert.equal(state.followUp, null);
  assert.equal(handoffSummary("work", { ...work, assignee_id: "private-id" }, [], people).lines[0].next, "由負責人跟進");
  assert.equal(handoffSummary("work", undefined, [{ ...base, status: "completed" }], people).lines[0].next, "未有後續交接資料");
});
