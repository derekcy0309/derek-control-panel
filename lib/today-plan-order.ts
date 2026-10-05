import type { PlanningMetadata } from "./types.ts";

const roleOrder = { now: 0, later: 1, quick_win: 2 } as const;

export function orderTodayPlan<T extends Pick<PlanningMetadata, "plan_role" | "plan_position" | "plan_source" | "resource_id">>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const leftPosition = left.plan_source === "manual" ? left.plan_position ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    const rightPosition = right.plan_source === "manual" ? right.plan_position ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    return leftPosition - rightPosition
      || roleOrder[left.plan_role ?? "later"] - roleOrder[right.plan_role ?? "later"]
      || left.resource_id.localeCompare(right.resource_id);
  });
}
