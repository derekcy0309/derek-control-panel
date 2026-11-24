import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { priorityFromTaskTags, taskMatchesTagText, taskTagPriorityChange } from "../lib/task-tag-ui.ts";
import { actionableTask, isMyTask, simplePriority, simpleToday, sortByPriority, taskTagNameError } from "../lib/simple-mode.ts";
import type { Assignment, PlanningMetadata, Task, TaskDependency } from "../lib/types.ts";

const base: Task = { id: "a", user_id: "derek", owner_id: "derek", title: "A", scope: "home", source_type: "follow_up", owner: null, due_date: null, follow_up_date: null, status: "not_started", next_action: null, risk: "low", notes: null, completed_at: null, deleted_at: null, archived_at: null, created_at: "2026-11-01", updated_at: "2026-11-01", requested_priority: 3 };
const input = { tasks: [base], planning: [] as PlanningMetadata[], dependencies: [] as TaskDependency[], assignments: [] as Assignment[], userId: "derek", today: "2026-11-14" };
test("simple mode ranks solely by explicit priority and keeps stable ties", () => {
  const tasks = [{...base,id:"low",requested_priority:5,due_date:"2020-01-01",energy_level:"low" as const}, {...base,id:"p1",requested_priority:1,energy_level:"high" as const}, {...base,id:"p2"},{...base,id:"p2-next",risk:"high" as const}];
  assert.deepEqual(sortByPriority(tasks).map(t=>t.id),["p1","p2","p2-next","low"]);
  assert.deepEqual([undefined,1,2,3,4,5].map(simplePriority),[3,1,1,3,3,5]);
});
test("top three never include waiting, blocked dependencies, non-work dates or others' work", () => {
  const tasks: Task[] = [base, {...base,id:"waiting",status:"waiting"},{...base,id:"blocked",requested_priority:1},{...base,id:"off-day",work_dates:["2026-11-15"]},{...base,id:"other",owner_id:"suki"},...Array.from({length:4},(_,i)=>({...base,id:`next${i}`}))];
  const dependencies = [{task_id:"blocked",depends_on_task_id:"missing"}] as TaskDependency[];
  const plan=simpleToday({...input,tasks,dependencies});
  assert.deepEqual(plan.top.map(t=>t.id),["a","next0","next1"]);
  assert.equal(actionableTask(tasks[2],dependencies,tasks),false);
});
test("manual Today order wins over priority, completion promotes the next, and never pads the day", () => {
  const tasks=[{...base,id:"first",requested_priority:5},{...base,id:"second",requested_priority:1},base];
  const planning=["first","second"].map((id,i)=>({user_id:"derek",resource_type:"task",resource_id:id,planned_date:input.today,plan_role:i?"later":"now",plan_source:"manual",plan_position:i+1})) as PlanningMetadata[];
  assert.deepEqual(simpleToday({...input,tasks,planning}).top.map(t=>t.id),["first","second"]);
  tasks[0]={...tasks[0],status:"done"};
  assert.deepEqual(simpleToday({...input,tasks,planning}).top.map(t=>t.id),["second"]);
  tasks[1]={...tasks[1],status:"done"};
  assert.deepEqual(simpleToday({...input,tasks,planning}).top,[]);
});
test("accepted handoff belongs to receiver, pending handoff does not silently become their task", () => {
  const assignments=[{resource_type:"task",resource_id:base.id,assigned_to_id:"suki",status:"accepted"}] as Assignment[];
  assert.equal(isMyTask(base,"suki",assignments),true); assert.equal(isMyTask(base,"derek",assignments),false);
  assert.equal(isMyTask(base,"suki",[{...assignments[0],status:"pending_acceptance"}]),false);
});
test("hidden and snoozed planning are never resurfaced as a Now suggestion", () => {
  const tasks=[base,{...base,id:"snoozed"},{...base,id:"next"}];
  const defaults={personal_priority:3,pinned:false,hidden_from_today:false,snoozed_until:null};
  const planning: PlanningMetadata[]=[{...defaults,user_id:"derek",resource_type:"task",resource_id:base.id,planned_date:input.today,plan_role:"now",hidden_from_today:true},
    {...defaults,user_id:"derek",resource_type:"task",resource_id:"snoozed",planned_date:input.today,plan_role:"later",snoozed_until:"2026-11-15"}];
  assert.deepEqual(simpleToday({...input,tasks,planning}).top.map(t=>t.id),["next"]);
  assert.deepEqual(simpleToday({...input,tasks:[base],planning:[{...planning[0],user_id:"suki",hidden_from_today:false}]}).planned,[]);
});
test("tags are bounded, viewer private and cannot replace legacy scope/privacy", () => {
  assert.ok(taskTagNameError(" ")); assert.ok(taskTagNameError("x".repeat(41))); assert.equal(taskTagNameError("Wecare"),null);
  const migration=readFileSync("supabase/migrations/20261113172120_personal_task_tags.sql","utf8");
  assert.match(migration,/security invoker set search_path = ''/); assert.doesNotMatch(migration,/security definer|update public\.tasks|delete from public\.tasks/i);
  assert.match(migration,/if initialized is null then return/); assert.match(migration,/user_id = \(select auth.uid\(\)\)/);
  const form=readFileSync("components/forms/TaskForm.tsx","utf8");
  assert.match(form,/tagsTouched \? selectedTags : undefined/); assert.doesNotMatch(form,/taskCategory: payload|<span className="label">能量|estimated_minutes: payload|energy_level: payload/);
  assert.match(form,/clientRequestId:/); assert.match(form,/Tags 分類|TaskTagPicker/);
  const api=readFileSync("app/api/control/route.ts","utf8");
  assert.doesNotMatch(api,/priorityValueForDueDate|datedPriority/);
});

test("priority tags affect rank only after an explicit change, including removal of the last priority tag", () => {
  const catalog = [
    { id: "owner-p1", name: "今日優先", legacy_key: "priority_p1" },
    { id: "owner-p2", name: "P2", legacy_key: "priority_p2" },
    { id: "owner-p3", name: "p3", legacy_key: null },
    { id: "owner-wecare", name: "WECARE", legacy_key: "wecare" },
  ];
  assert.equal(priorityFromTaskTags([], catalog), null);
  assert.equal(priorityFromTaskTags(["owner-p3", "owner-p1"], catalog), 1);
  assert.equal(priorityFromTaskTags(["owner-p3"], catalog), 5);
  assert.equal(taskTagPriorityChange(["owner-p1"], ["owner-p1", "owner-wecare"], catalog), undefined);
  assert.equal(taskTagPriorityChange(["owner-p1"], [], catalog), 3);
  assert.equal(taskTagPriorityChange(["owner-p3"], ["owner-p2"], catalog), 3);
  assert.equal(taskTagPriorityChange([], ["owner-wecare"], catalog), undefined);
});

test("the task list can search the viewer's real tag names, with SEC and 恩海居 treated as one label", () => {
  const tagNames = new Map([["one", "SEC"], ["two", "WECARE"]]);
  const task = { title: "遞交報表", personal_tag_ids: ["one", "other-user-s-tag"] };
  assert.ok(taskMatchesTagText(task, "報表", tagNames));
  assert.ok(taskMatchesTagText(task, "sec", tagNames));
  assert.ok(taskMatchesTagText(task, "恩海居", tagNames));
  assert.equal(taskMatchesTagText(task, "wecare", tagNames), false);
  assert.equal(taskMatchesTagText(task, "other-user-s-tag", tagNames), false);
});
