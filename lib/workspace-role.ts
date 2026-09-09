import type { Task, WorkspaceRole, WorkflowTaskType } from "@/lib/types";

export const workspaceRoleLabels: Record<WorkspaceRole, string> = {
  general: "一般工作首頁",
  derek: "Derek 工作首頁",
  suki: "Suki 工作首頁",
  amigo: "Amigo 工作首頁"
};

export const taskTypeLabels: Record<WorkflowTaskType, string> = {
  general: "一般工作",
  intake: "待整理",
  scheduling: "時間安排",
  materials: "文件整理",
  rn_coordination: "等待別人",
  follow_up: "跟進",
  sop: "工作流程",
  ai_document: "文件草稿",
  system_issue: "系統工作",
  compliance: "檢查事項",
  training: "學習及進修",
  assessment: "等待覆核",
  family_conference: "會議工作"
};

export function resolveWorkspaceRole(input: {
  configured?: WorkspaceRole | null;
  email?: string | null;
  displayName?: string | null;
}): WorkspaceRole {
  if (input.configured && input.configured !== "general") return input.configured;
  const identity = `${input.email ?? ""} ${input.displayName ?? ""}`.toLowerCase();
  if (identity.includes("love29suki") || identity.includes("suki")) return "suki";
  if (identity.includes("amigo")) return "amigo";
  if (
    identity.includes("derekcy0309")
    || identity.includes("derek")
    || identity.includes("kwok_cy")
  ) return "derek";
  return input.configured ?? "general";
}

export function roleTaskLabel(role: WorkspaceRole, task: Task) {
  const type = task.task_type ?? "general";
  if (role === "suki") {
    if (task.status === "waiting") return "等待別人";
    if (task.status === "blocked") return "需要重新安排";
  }
  if (role === "amigo") {
    if (["sop", "ai_document", "system_issue", "compliance", "training"].includes(type)) {
      return taskTypeLabels[type];
    }
  }
  if (role === "derek") {
    if (task.safety_impact || task.risk === "high") return "高風險／緊急";
    if (task.needs_decision_from_id && !task.decision_resolved_at) return "等待我決定";
  }
  return taskTypeLabels[type];
}
