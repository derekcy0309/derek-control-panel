export type Permission = "view" | "comment" | "update_status" | "edit" | "co_owner";
export type AccessContext = {
  userId: string;
  ownerId: string;
  area?: "personal" | "family" | "work";
  visibility?: "private" | "household" | "shared" | "assigned" | "joint";
  householdId?: string | null;
  householdMembership?: { householdId: string; status: "invited" | "accepted" | "declined" } | null;
  share?: { sharedWithUserId: string; permission: Permission; revokedAt?: string | null; expiresAt?: string | null } | null;
  assignment?: { assignedToId: string; status: string } | null;
  joint?: { userId: string; acceptedAt?: string | null; removedAt?: string | null } | null;
  now?: string;
};

export function canReadResource(context: AccessContext) {
  if (context.userId === context.ownerId) return true;
  if (
    context.area === "family"
    && context.visibility === "household"
    && context.householdId
    && context.householdMembership?.householdId === context.householdId
    && context.householdMembership.status === "accepted"
  ) return true;
  const now = context.now ?? new Date().toISOString();
  const share = context.share;
  if (share?.sharedWithUserId === context.userId && !share.revokedAt && (!share.expiresAt || share.expiresAt > now)) return true;
  if (context.assignment?.assignedToId === context.userId && ["accepted","in_progress","blocked","completed"].includes(context.assignment.status)) return true;
  return context.joint?.userId === context.userId && Boolean(context.joint.acceptedAt) && !context.joint.removedAt;
}

export function canDeleteResource(context: AccessContext) { return context.userId === context.ownerId; }
export function canReshareResource(context: AccessContext) { return context.userId === context.ownerId; }

export function allowedTaskUpdateFields(context: AccessContext) {
  if (context.userId === context.ownerId) return ownerTaskFields;
  if (!canReadResource(context)) return [];
  const householdPermission = context.area === "family"
    && context.visibility === "household"
    && context.householdId
    && context.householdMembership?.householdId === context.householdId
    && context.householdMembership.status === "accepted"
    ? "update_status"
    : null;
  const permission = context.share?.permission
    ?? (context.assignment?.assignedToId === context.userId ? "update_status" : context.joint?.acceptedAt ? "co_owner" : householdPermission ?? "view");
  if (permission === "co_owner") return coOwnerTaskFields;
  if (permission === "edit") return editorTaskFields;
  if (permission === "update_status") return statusTaskFields;
  return [];
}

export function canUpdateTaskFields(context: AccessContext, fields: string[]) {
  const allowed = new Set(allowedTaskUpdateFields(context));
  return fields.length > 0 && fields.every((field) => allowed.has(field));
}

export function masksPrivateCount(visibleRows: unknown[]) { return visibleRows.length; }

const statusTaskFields = ["status","progress","blocked_reason","completed_at","last_progress_at","actual_minutes","updated_at"];
const editorTaskFields = [...statusTaskFields,"title","description","next_action","definition_of_done","due_date","planned_date","estimated_minutes","energy_level","context","risk","notes"];
const coOwnerTaskFields = [...editorTaskFields,"requested_priority","critical_path","safety_impact","child_impact","legal_impact","assignee_id"];
const ownerTaskFields = [...coOwnerTaskFields,"visibility","archived_at","deleted_at"];
