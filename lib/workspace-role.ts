import type { Task, WorkspaceRole, WorkflowTaskType } from "@/lib/types";

export const workspaceRoleLabels: Record<WorkspaceRole, string> = {
  general: "一般工作首頁",
  derek: "Derek 工作首頁",
  suki: "Suki 工作首頁",
  amigo: "Amigo 工作首頁"
};

export const taskTypeLabels: Record<WorkflowTaskType, string> = {
  general: "一般工作",
  intake: "Intake",
  scheduling: "Scheduling",
  materials: "物資準備",
  rn_coordination: "RN 安排",
  follow_up: "跟進",
  sop: "SOP",
  ai_document: "AI／文件草稿",
  system_issue: "系統問題",
  compliance: "Compliance／CCSV",
  training: "Training Material",
  assessment: "Assessment",
  family_conference: "Family Conference"
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
    if (type === "rn_coordination" || task.rn_required) return "待安排 RN";
    if (type === "materials" || task.materials_required) return "待準備物資";
    if (task.client_update_required) return "待回覆家屬";
    if (task.status === "blocked" || task.status === "waiting") return "需要重新安排";
  }
  if (role === "amigo") {
    if (["sop", "ai_document", "system_issue", "compliance", "training"].includes(type)) {
      return taskTypeLabels[type];
    }
  }
  if (role === "derek") {
    if (type === "assessment" || type === "family_conference") return taskTypeLabels[type];
    if (task.safety_impact || task.risk === "high") return "高風險／緊急";
  }
  return taskTypeLabels[type];
}

