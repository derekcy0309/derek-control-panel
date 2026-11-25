import type { SupabaseClient } from "@supabase/supabase-js";
import { orderTodayPlan } from "../today-plan-order.ts";
import { actionableTask, isMyTask, snoozedPastToday } from "../simple-mode.ts";

// Called only AFTER agent_brief_owner authenticates an opted-in owner-only grant.
// This is not a new tool for an agent to query by arbitrary task, user, or date.
export async function readBriefStartTitle(client: SupabaseClient, owner: string, today: string): Promise<string | null> {
  const planned = await client.from("user_planning_metadata")
    .select("resource_id,plan_position,plan_source,plan_role,snoozed_until")
    .eq("user_id",owner).eq("resource_type","task").eq("planned_date",today)
    .eq("hidden_from_today",false).not("plan_role","is",null).limit(101);
  if (planned.error || !planned.data?.length || planned.data.length > 100) return null;
  const plan = orderTodayPlan(planned.data.filter(row => !snoozedPastToday(row.snoozed_until,today)));
  if (!plan.length || !plan.some(row => row.plan_source === "manual")) return null;

  const own = await client.from("tasks").select("id,owner_id,status,blocked_reason,snoozed_until,deleted_at,archived_at")
    .eq("owner_id",owner).in("id",plan.map(row => row.resource_id)).limit(100);
  if (own.error || !own.data?.length) return null;
  const tasks = new Map(own.data.filter(task => task.owner_id === owner).map(task => [task.id,task]));
  const ids = [...tasks.keys()];
  if (!ids.length) return null;
  const [steps, assignments, dependencies] = await Promise.all([
    client.from("task_current_steps").select("task_id,status").in("task_id",ids).limit(101),
    client.from("assignments").select("resource_type,resource_id,assigned_to_id,status").eq("resource_type","task")
      .in("resource_id",ids).in("status",["pending_acceptance","accepted","in_progress","waiting","blocked"]).limit(201),
    client.from("task_dependencies").select("task_id,depends_on_task_id").in("task_id",ids).limit(401)
  ]);
  if (steps.error || assignments.error || dependencies.error || !steps.data || !assignments.data || !dependencies.data
    || steps.data.length > 100 || assignments.data.length > 200 || dependencies.data.length > 400) return null;
  const prerequisiteIds = [...new Set(dependencies.data.map(item => item.depends_on_task_id))];
  const prerequisites = prerequisiteIds.length ? await client.from("tasks").select("id,status")
    .eq("owner_id",owner).in("id",prerequisiteIds).is("archived_at",null).is("deleted_at",null).limit(400) : { data: [], error: null };
  if (prerequisites.error || !prerequisites.data) return null;
  const known = new Set(prerequisites.data.map(task => task.id));
  for (const row of plan) {
    const task = tasks.get(row.resource_id);
    // A shared task may be first on the human dashboard; never read its title or
    // claim that a different owned task is first. Missing prerequisite access or
    // an automatically planned row are similarly ambiguous, so link without a name.
    if (!task || row.plan_source !== "manual") return null;
    if (!isMyTask({...task,user_id:owner}, owner, assignments.data) || snoozedPastToday(task.snoozed_until,today)) continue;
    if (dependencies.data.some(edge => edge.task_id === task.id && !known.has(edge.depends_on_task_id))) return null;
    const active = { ...task, current_step_status: steps.data.find(step => step.task_id === task.id)?.status ?? null };
    if (!actionableTask(active,dependencies.data,prerequisites.data)) continue;
    // Fetch only the winner's title; recheck ownership and lifecycle at this boundary.
    const title = await client.from("tasks").select("title").eq("id",task.id).eq("owner_id",owner)
      .eq("status",task.status).is("archived_at",null).is("deleted_at",null).maybeSingle();
    return !title.error && typeof title.data?.title === "string" ? title.data.title : null;
  }
  return null;
}
