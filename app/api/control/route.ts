import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type RequestContext = { client: SupabaseClient; user: User; origin: string };

export async function GET(request: NextRequest) {
  const context = await authenticate(request);
  if (context instanceof Response) return context;

  const view = request.nextUrl.searchParams.get("view") ?? "bootstrap";
  if (view === "search") return search(context, request.nextUrl.searchParams.get("q") ?? "");
  if (view === "task_checkpoints") return taskCheckpoints(context, request.nextUrl.searchParams.get("taskId") ?? "");
  if (view === "inbox_processing") return inboxProcessing(context, request.nextUrl.searchParams);
  if (view !== "bootstrap") return jsonError("不支援的資料檢視。", 400);

  const { client, user } = context;
  const displayName = inferDisplayName(user);
  const [profile, settings, tasks, transactions, meetings, balances, items, shares, assignments, handoffNotes, planning, capacity, participants] =
    await Promise.all([
      client.from("user_profiles").select("*").eq("user_id", user.id).maybeSingle(),
      client.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
      client.from("tasks").select("*").is("deleted_at", null).is("archived_at", null).order("due_date", { ascending: true, nullsFirst: false }),
      client.from("transactions").select("*").is("archived_at", null).order("expected_date", { ascending: true, nullsFirst: false }),
      client.from("meetings").select("*").is("archived_at", null).order("meeting_date", { ascending: false }),
      client.from("balances").select("*").is("archived_at", null).order("month", { ascending: false }),
      client.from("operating_items").select("*").is("archived_at", null).order("due_date", { ascending: true, nullsFirst: false }),
      client.from("share_records").select("*").order("created_at", { ascending: false }),
      client.from("assignments").select("*").order("created_at", { ascending: false }),
      client.from("task_handoff_notes").select("*").order("created_at", { ascending: false }),
      client.from("user_planning_metadata").select("*").eq("user_id", user.id),
      client.from("daily_capacity_checkins").select("*").eq("user_id", user.id).order("checkin_date", { ascending: false }).limit(1).maybeSingle(),
      client.rpc("participant_profiles")
    ]);

  const firstError = [profile, settings, tasks, transactions, meetings, balances, items, shares, assignments, handoffNotes, planning, capacity, participants]
    .find((result) => result.error)?.error;
  if (firstError) return databaseError(firstError);

  if (!profile.data) {
    const created = await client.from("user_profiles").insert({ user_id: user.id, display_name: displayName }).select("*").single();
    if (created.error) return databaseError(created.error);
    profile.data = created.data;
  }
  if (!settings.data) {
    const gentle = displayName.toLowerCase() === "suki";
    const created = await client.from("user_settings").insert({
      user_id: user.id,
      email: user.email ?? null,
      gentle_mode: gentle,
      dashboard_density: gentle ? "calm" : "comfortable"
    }).select("*").single();
    if (created.error) return databaseError(created.error);
    settings.data = created.data;
  }

  return Response.json({
    currentUser: { id: user.id, email: user.email ?? "", displayName: profile.data.display_name },
    profile: profile.data,
    settings: settings.data,
    tasks: tasks.data ?? [],
    transactions: transactions.data ?? [],
    meetings: meetings.data ?? [],
    balances: balances.data ?? [],
    operatingItems: items.data ?? [],
    shares: shares.data ?? [],
    assignments: assignments.data ?? [],
    handoffNotes: handoffNotes.data ?? [],
    planning: planning.data ?? [],
    capacity: capacity.data ?? null,
    participants: participants.data ?? []
  }, { headers: privateHeaders() });
}

export async function POST(request: NextRequest) {
  const context = await authenticate(request);
  if (context instanceof Response) return context;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("請求格式不正確。", 400);
  }
  const action = stringValue(body.action);
  switch (action) {
    case "create_task": return createTask(context, body);
    case "update_task": return updateTask(context, body);
    case "save_transaction": return saveTransaction(context, body);
    case "save_meeting": return saveMeeting(context, body);
    case "save_balance": return saveBalance(context, body);
    case "create_item": return createOperatingItem(context, body);
    case "update_item": return updateOperatingItem(context, body);
    case "share": return shareResource(context, body);
    case "handoff_task": return startTaskHandoff(context, body);
    case "handoff_reclaim": return reclaimTaskHandoff(context, body);
    case "handoff_progress": return recordTaskHandoffProgress(context, body);
    case "handoff_resolve": return resolveTaskHandoff(context, body);
    case "assignment_response": return respondToAssignment(context, body);
    case "joint_response": return respondToJoint(context, body);
    case "revoke_share": return revokeShare(context, body);
    case "save_settings": return saveSettings(context, body);
    case "admin_reset_password": return adminResetPassword(context, body);
    case "capacity_checkin": return saveCapacity(context, body);
    case "save_checkpoint_draft": return saveTaskCheckpoint(context, body, "draft");
    case "save_checkpoint": return saveTaskCheckpoint(context, body, "saved");
    case "process_inbox_item": return processInboxItem(context, body);
    case "undo_inbox_processing": return undoInboxProcessing(context, body);
    default: return jsonError("不支援的操作。", 400);
  }
}

async function authenticate(request: NextRequest): Promise<RequestContext | Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization") ?? "";
  const token = request.cookies.get("dcp_access")?.value ?? (authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
  if (!url || !key) return jsonError("伺服器尚未設定資料庫。", 503);
  if (!token) return jsonError("登入已失效，請重新登入。", 401);

  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return jsonError("登入已失效，請重新登入。", 401);
  return { client, user: data.user, origin: request.nextUrl.origin };
}

async function inboxProcessing(
  { client, user }: RequestContext,
  searchParams: URLSearchParams
) {
  const sessionId = uuidValue(searchParams.get("sessionId"));
  const page = integerValue(searchParams.get("page") ?? "1", 1, 10000) ?? 1;
  if (!sessionId) return jsonError("收集箱處理 session 不正確。", 400);

  const pageSize = 20;
  const offset = (page - 1) * pageSize;
  const availableBefore = new Date().toISOString();
  const queueFilter = `inbox_available_after.is.null,inbox_available_after.lte.${availableBefore}`;
  const queue = client.from("operating_items")
    .select("*", { count: "exact" })
    .eq("owner_id", user.id)
    .eq("item_type", "inbox")
    .eq("status", "inbox")
    .is("archived_at", null)
    .is("inbox_processed_at", null)
    .or(queueFilter)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + pageSize - 1);
  const current = client.from("operating_items")
    .select("*")
    .eq("owner_id", user.id)
    .eq("item_type", "inbox")
    .eq("status", "inbox")
    .is("archived_at", null)
    .is("inbox_processed_at", null)
    .or(queueFilter)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  const processed = client.from("inbox_processing_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("session_id", sessionId)
    .is("undone_at", null);
  const lastUndoable = client.from("inbox_processing_events")
    .select("id,inbox_item_id,action,target_type,target_id,processed_at,undone_at")
    .eq("user_id", user.id)
    .is("undone_at", null)
    .gte("processed_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .order("processed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const participants = client.rpc("participant_profiles");

  const [queueResult, currentResult, processedResult, undoResult, participantResult] =
    await Promise.all([queue, current, processed, lastUndoable, participants]);
  const firstError = [queueResult, currentResult, processedResult, undoResult, participantResult]
    .find((result) => result.error)?.error;
  if (firstError) return databaseError(firstError);

  const totalRemaining = queueResult.count ?? 0;
  const sessionProcessed = processedResult.count ?? 0;
  const sessionTotal = totalRemaining + sessionProcessed;

  return Response.json({
    currentUser: {
      id: user.id,
      email: user.email ?? "",
      displayName: inferDisplayName(user)
    },
    currentItem: currentResult.data ?? null,
    items: queueResult.data ?? [],
    totalRemaining,
    sessionProcessed,
    sessionTotal,
    position: totalRemaining > 0 ? sessionProcessed + 1 : sessionProcessed,
    participants: participantResult.data ?? [],
    lastUndoable: undoResult.data ?? null,
    page,
    pageSize
  }, { headers: privateHeaders() });
}

async function processInboxItem(
  { client }: RequestContext,
  body: Record<string, unknown>
) {
  const inboxItemId = uuidValue(body.inboxItemId);
  const sessionId = uuidValue(body.sessionId);
  const idempotencyKey = uuidValue(body.idempotencyKey);
  const action = enumValue(body.processingAction, [
    "do_now",
    "create_task",
    "add_project",
    "add_waiting",
    "assign",
    "schedule",
    "keep_note",
    "skip"
  ], null);
  if (!inboxItemId || !sessionId || !idempotencyKey || !action) {
    return jsonError("收集箱處理資料不正確。", 400);
  }

  const options = inboxProcessingOptions(body.options);
  if (options instanceof Response) return options;
  if (action === "do_now" && !options.nextAction) {
    return jsonError("請輸入立即開始的下一個最小步驟。", 422);
  }
  if (action === "schedule" && !options.plannedDate) {
    return jsonError("請選擇安排日期。", 422);
  }
  if (action === "assign" && (!options.handoffToUserId || !options.handoffNote)) {
    return jsonError("請選擇跟進者並輸入交接 notes。", 422);
  }

  const result = await client.rpc("process_inbox_item", {
    p_inbox_item_id: inboxItemId,
    p_action: action,
    p_session_id: sessionId,
    p_idempotency_key: idempotencyKey,
    p_options: options
  });
  if (result.error) return databaseError(result.error);
  const event = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!event) return jsonError("未能讀取收集箱處理結果。", 500);

  return Response.json({
    event: {
      id: event.event_id,
      inbox_item_id: inboxItemId,
      action: event.processed_action,
      target_type: event.target_type,
      target_id: event.target_id,
      processed_at: event.processed_at,
      undone_at: null
    }
  }, { headers: privateHeaders() });
}

async function undoInboxProcessing(
  { client }: RequestContext,
  body: Record<string, unknown>
) {
  const eventId = uuidValue(body.eventId);
  if (!eventId) return jsonError("找不到可撤銷的收集箱處理。", 400);

  const result = await client.rpc("undo_last_inbox_processing", {
    p_event_id: eventId
  });
  if (result.error) return databaseError(result.error);
  const restored = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!restored) return jsonError("未能讀取撤銷結果。", 500);
  return Response.json({
    eventId: restored.event_id,
    restoredInboxItemId: restored.restored_inbox_item_id
  }, { headers: privateHeaders() });
}

async function createTask({ client, user }: RequestContext, body: Record<string, unknown>) {
  const title = requiredText(body.title, "請輸入任務標題。");
  if (title instanceof Response) return title;
  const requestedHandoffTarget = nullableText(body.handoffToUserId);
  const handoffTarget = requestedHandoffTarget ? uuidValue(requestedHandoffTarget) : null;
  const handoffNote = nullableText(body.handoffNote);
  if (requestedHandoffTarget && !handoffTarget) return jsonError("交接對象不正確。", 400);
  if (handoffTarget === user.id) return jsonError("請選擇另一位跟進者。", 422);
  if (handoffTarget && !handoffNote) return jsonError("請輸入交接 notes，讓對方知道第一步。", 422);
  const status = enumValue(body.status, ["not_started", "in_progress", "waiting", "done", "blocked", "cancelled"], "not_started");
  const nextAction = nullableText(body.nextAction);
  if (status === "in_progress" && !nextAction) return jsonError("開始任務前必須設定清晰的下一步。", 422);
  const payload = {
    user_id: user.id,
    owner_id: user.id,
    created_by_id: user.id,
    visibility: "private",
    scope: enumValue(body.area, ["work", "family", "personal"], "personal") === "work" ? "company" : "home",
    area: enumValue(body.area, ["work", "family", "personal"], "personal"),
    source_type: enumValue(body.sourceType, ["meeting_action", "deadline", "follow_up"], "follow_up"),
    title,
    description: nullableText(body.description),
    due_date: dateValue(body.dueDate),
    follow_up_date: dateValue(body.followUpDate),
    planned_date: dateValue(body.plannedDate),
    status,
    next_action: nextAction,
    definition_of_done: nullableText(body.definitionOfDone),
    estimated_minutes: integerValue(body.estimatedMinutes, 0, 14400),
    energy_level: enumValue(body.energyLevel, ["low", "medium", "high"], null),
    context: nullableText(body.context),
    risk: enumValue(body.risk, ["low", "medium", "high"], "low"),
    requested_priority: integerValue(body.requestedPriority, 1, 5) ?? 3,
    critical_path: Boolean(body.criticalPath),
    safety_impact: Boolean(body.safetyImpact),
    child_impact: Boolean(body.childImpact),
    legal_impact: Boolean(body.legalImpact),
    estimated_duration_days: integerValue(body.estimatedDurationDays, 0, 3650),
    buffer_days: integerValue(body.bufferDays, 0, 365) ?? 0,
    notes: nullableText(body.notes)
  };
  const result = await client.from("tasks").insert(payload).select("*").single();
  if (result.error) return databaseError(result.error);
  let assignmentId: string | null = null;
  if (handoffTarget && handoffNote) {
    const handoff = await client.rpc("start_task_handoff", {
      p_task_id: result.data.id,
      p_target_user_id: handoffTarget,
      p_note: handoffNote,
      p_due_date: payload.due_date
    });
    if (handoff.error) {
      await client.from("tasks").delete().eq("id", result.data.id);
      return databaseError(handoff.error);
    }
    assignmentId = handoff.data;
  }
  await recordActivity(client, user.id, "task", result.data.id, "create", "建立任務");
  if (assignmentId) await recordActivity(client, user.id, "task", result.data.id, "handoff", "建立後直接交俾對方跟進");
  return Response.json({ task: result.data, assignmentId }, { status: 201, headers: privateHeaders() });
}

async function updateTask({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (!id) return jsonError("任務識別碼不正確。", 400);
  const existing = await client.from("tasks").select("*").eq("id", id).maybeSingle();
  if (existing.error) return databaseError(existing.error);
  if (!existing.data) return jsonError("找不到任務或你沒有權限。", 404);

  const changes = objectValue(body.changes);
  const allowed = existing.data.owner_id === user.id
    ? ["title","description","status","next_action","definition_of_done","due_date","follow_up_date","planned_date","estimated_minutes","energy_level","context","risk","requested_priority","critical_path","safety_impact","child_impact","legal_impact","blocked_reason","progress","actual_minutes","notes","archived_at","deleted_at","snoozed_until","last_progress_at","completed_at"]
    : ["status","blocked_reason","progress","actual_minutes","last_progress_at","completed_at"];
  const payload = pick(changes, allowed);
  if (payload.status === "in_progress" && !stringValue(payload.next_action ?? existing.data.next_action)) {
    return jsonError("開始任務前必須設定清晰的下一步。", 422);
  }
  if (payload.status === "done") payload.completed_at = new Date().toISOString();
  payload.last_progress_at = new Date().toISOString();
  const result = await client.from("tasks").update(payload).eq("id", id).select("*").maybeSingle();
  if (result.error) return databaseError(result.error);
  if (!result.data) return jsonError("更新被拒絕。", 403);
  await recordActivity(client, user.id, "task", id, payload.status === "done" ? "complete" : "update", "更新任務");
  return Response.json({ task: result.data }, { headers: privateHeaders() });
}

async function saveTransaction({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (id) {
    const existing = await client.from("transactions").select("user_id").eq("id", id).maybeSingle();
    if (existing.error) return databaseError(existing.error);
    if (!existing.data || existing.data.user_id !== user.id) return jsonError("只有擁有者可以修改此財務項目。", 403);
  }
  const item = requiredText(body.item, "請輸入項目名稱。");
  if (item instanceof Response) return item;
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999999) return jsonError("金額必須大於 0。", 422);
  const type = enumValue(body.type, ["income","expense"], "expense")!;
  const status = type === "income"
    ? enumValue(body.status, ["expected","received","delayed","problem","cancelled"], "expected")
    : enumValue(body.status, ["unpaid","paid","problem","skipped","cancelled"], "unpaid");
  const payload = {
    user_id: user.id, scope: enumValue(body.scope, ["home","company"], "home"), type, item,
    category: nullableText(body.category), amount, expected_date: dateValue(body.expected_date), actual_date: dateValue(body.actual_date),
    frequency: enumValue(body.frequency, ["monthly","one_time","irregular"], "one_time"), status,
    payment_method: nullableText(body.payment_method), owner: nullableText(body.owner), proof_url: safeUrl(body.proof_url), notes: nullableText(body.notes)
  };
  const result = id
    ? await client.from("transactions").update(payload).eq("id", id).select("*").single()
    : await client.from("transactions").insert(payload).select("*").single();
  if (result.error) return databaseError(result.error);
  return Response.json({ transaction: result.data }, { status: id ? 200 : 201, headers: privateHeaders() });
}

async function saveMeeting({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (id) {
    const existing = await client.from("meetings").select("user_id").eq("id", id).maybeSingle();
    if (existing.error) return databaseError(existing.error);
    if (!existing.data || existing.data.user_id !== user.id) return jsonError("只有擁有者可以修改此會議。", 403);
  }
  const name = requiredText(body.meeting_name, "請輸入會議名稱。");
  if (name instanceof Response) return name;
  const payload: Record<string, unknown> = {
    user_id: user.id, scope: enumValue(body.scope, ["home","company"], "company"), meeting_name: name,
    meeting_date: dateValue(body.meeting_date), raw_notes: nullableText(body.raw_notes), summary: nullableText(body.summary)
  };
  if (body.archived_at) payload.archived_at = stringValue(body.archived_at);
  const result = id
    ? await client.from("meetings").update(payload).eq("id", id).select("*").single()
    : await client.from("meetings").insert(payload).select("*").single();
  if (result.error) return databaseError(result.error);
  return Response.json({ meeting: result.data }, { status: id ? 200 : 201, headers: privateHeaders() });
}

async function saveBalance({ client, user }: RequestContext, body: Record<string, unknown>) {
  const scope = enumValue(body.scope, ["home","company"], null);
  const month = dateValue(body.month);
  const openingBalance = Number(body.opening_balance);
  if (!scope || !month || !Number.isFinite(openingBalance)) return jsonError("期初結餘資料不正確。", 422);
  const result = await client.from("balances").upsert({ user_id: user.id, scope, month, opening_balance: openingBalance }, { onConflict: "user_id,scope,month" }).select("*").single();
  if (result.error) return databaseError(result.error);
  return Response.json({ balance: result.data }, { headers: privateHeaders() });
}

async function createOperatingItem({ client, user }: RequestContext, body: Record<string, unknown>) {
  const title = requiredText(body.title, "請輸入項目名稱。");
  if (title instanceof Response) return title;
  const payload = {
    item_type: enumValue(body.itemType, itemTypes, "note"),
    title,
    description: nullableText(body.description),
    status: enumValue(body.status, ["inbox","active","waiting","blocked","review","completed","cancelled"], "active"),
    area: enumValue(body.area, ["work","family","personal"], "personal"),
    owner_id: user.id,
    created_by_id: user.id,
    visibility: "private",
    due_date: dateValue(body.dueDate),
    next_action: nullableText(body.nextAction),
    sensitive: Boolean(body.sensitive),
    metadata: objectValue(body.metadata),
    last_progress_at: new Date().toISOString()
  };
  const result = await client.from("operating_items").insert(payload).select("*").single();
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "operating_item", result.data.id, "create", "建立項目");
  return Response.json({ item: result.data }, { status: 201, headers: privateHeaders() });
}

async function updateOperatingItem({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (!id) return jsonError("項目識別碼不正確。", 400);
  const existing = await client.from("operating_items").select("owner_id").eq("id", id).maybeSingle();
  if (existing.error) return databaseError(existing.error);
  if (!existing.data) return jsonError("找不到項目或你沒有權限。", 404);
  const owner = existing.data.owner_id === user.id;
  const changes = objectValue(body.changes);
  const payload = pick(changes, owner ? ["title","description","status","due_date","next_action","metadata","archived_at","last_progress_at"] : ["status","last_progress_at"]);
  payload.last_progress_at = new Date().toISOString();
  const result = await client.from("operating_items").update(payload).eq("id", id).select("*").single();
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "operating_item", id, payload.status === "completed" ? "complete" : "update", "更新項目");
  return Response.json({ item: result.data }, { headers: privateHeaders() });
}

async function shareResource({ client, user }: RequestContext, body: Record<string, unknown>) {
  const resourceType = enumValue(body.resourceType, ["task","operating_item"], null);
  const resourceId = uuidValue(body.resourceId);
  const email = stringValue(body.targetEmail).trim();
  if (!resourceType || !resourceId || !email) return jsonError("請選擇項目並輸入對方的完整電郵。", 400);
  const resource = resourceType === "task"
    ? await client.from("tasks").select("id,owner_id").eq("id", resourceId).maybeSingle()
    : await client.from("operating_items").select("id,owner_id,sensitive").eq("id", resourceId).maybeSingle();
  if (resource.error) return databaseError(resource.error);
  if (!resource.data || resource.data.owner_id !== user.id) return jsonError("只有擁有者可以分享。", 403);
  const isSensitive = "sensitive" in resource.data && Boolean(resource.data.sensitive);

  const target = await client.rpc("resolve_share_target", { target_email: email });
  if (target.error) return databaseError(target.error);
  const recipient = target.data?.[0];
  if (!recipient) return jsonError("找不到這個已啟用帳戶。請確認完整電郵。", 404);
  const shareType = enumValue(body.shareType, ["reference","assignment","joint"], "reference");
  const permission = shareType === "assignment" ? "update_status" : shareType === "joint" ? "co_owner" : enumValue(body.permission, ["view","comment","update_status","edit"], "view");
  const includeAttachments = Boolean(body.includeAttachments) && !isSensitive;
  const share = await client.from("share_records").insert({
    resource_type: resourceType,
    resource_id: resourceId,
    owner_id: user.id,
    shared_with_user_id: recipient.user_id,
    permission,
    share_type: shareType,
    include_attachments: includeAttachments,
    include_comments: Boolean(body.includeComments),
    include_linked_documents: Boolean(body.includeLinkedDocuments) && !isSensitive,
    include_subtasks: Boolean(body.includeSubtasks)
  }).select("*").single();
  if (share.error) return databaseError(share.error);

  if (shareType === "assignment") {
    const assignment = await client.from("assignments").insert({
      resource_type: resourceType,
      resource_id: resourceId,
      assigned_by_id: user.id,
      assigned_to_id: recipient.user_id,
      due_date: dateValue(body.dueDate),
      requested_priority: integerValue(body.requestedPriority, 1, 5) ?? 3,
      definition_of_done: nullableText(body.definitionOfDone),
      instructions: nullableText(body.instructions)
    });
    if (assignment.error) return databaseError(assignment.error);
  }
  if (shareType === "joint") {
    const joint = await client.from("joint_memberships").insert({
      resource_type: resourceType,
      resource_id: resourceId,
      user_id: recipient.user_id,
      invited_by_id: user.id,
      role: "co_owner"
    });
    if (joint.error) return databaseError(joint.error);
  }
  const visibility = shareType === "reference" ? "shared" : shareType === "assignment" ? "assigned" : "joint";
  if (resourceType === "task") await client.from("tasks").update({ visibility }).eq("id", resourceId);
  else await client.from("operating_items").update({ visibility }).eq("id", resourceId);
  await client.from("share_audit_logs").insert({
    resource_type: resourceType, resource_id: resourceId, actor_id: user.id,
    target_user_id: recipient.user_id, action: shareType === "assignment" ? "assign" : shareType === "joint" ? "joint_invite" : "share",
    new_permission: permission, metadata: { includeAttachments, includeComments: Boolean(body.includeComments) }
  });
  return Response.json({ share: share.data, recipient: { id: recipient.user_id, displayName: recipient.display_name } }, { status: 201, headers: privateHeaders() });
}

async function startTaskHandoff({ client, user }: RequestContext, body: Record<string, unknown>) {
  const taskId = uuidValue(body.taskId);
  const targetUserId = uuidValue(body.targetUserId);
  const note = requiredText(body.note, "請輸入交接 notes，讓對方知道下一步。");
  if (!taskId || !targetUserId) return jsonError("交接對象或任務識別碼不正確。", 400);
  if (targetUserId === user.id) return jsonError("請選擇另一位跟進者。", 422);
  if (note instanceof Response) return note;

  const result = await client.rpc("start_task_handoff", {
    p_task_id: taskId,
    p_target_user_id: targetUserId,
    p_note: note,
    p_due_date: dateValue(body.dueDate)
  });
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "task", taskId, "handoff", "交俾對方跟進");
  return Response.json({ assignmentId: result.data }, { status: 201, headers: privateHeaders() });
}

async function reclaimTaskHandoff({ client, user }: RequestContext, body: Record<string, unknown>) {
  const assignmentId = uuidValue(body.assignmentId);
  const note = requiredText(body.note, "請輸入轉交 notes，讓雙方知道今次為何更改跟進者。");
  if (!assignmentId) return jsonError("交接識別碼不正確。", 400);
  if (note instanceof Response) return note;

  const found = await client
    .from("assignments")
    .select("resource_id,assigned_by_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (found.error) return databaseError(found.error);
  if (!found.data || found.data.assigned_by_id !== user.id) {
    return jsonError("只有目前交出任務的人可以直接收回跟進。", 403);
  }

  const result = await client.rpc("reclaim_task_handoff", {
    p_assignment_id: assignmentId,
    p_note: note
  });
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "task", found.data.resource_id, "reclaim", "收回任務繼續跟進");
  return Response.json({ assignmentId: result.data }, { headers: privateHeaders() });
}

async function recordTaskHandoffProgress({ client, user }: RequestContext, body: Record<string, unknown>) {
  const assignmentId = uuidValue(body.assignmentId);
  const status = enumValue(body.status, ["in_progress","waiting","blocked"], null);
  const progress = integerValue(body.progress, 0, 100);
  const note = requiredText(body.note, "請輸入今次進度 notes。");
  if (!assignmentId || !status || progress === null) return jsonError("交接進度資料不正確。", 400);
  if (note instanceof Response) return note;

  const found = await client.from("assignments").select("resource_id,assigned_to_id").eq("id", assignmentId).maybeSingle();
  if (found.error) return databaseError(found.error);
  if (!found.data || found.data.assigned_to_id !== user.id) return jsonError("只有目前跟進者可以更新進度。", 403);
  const result = await client.rpc("record_task_handoff_progress", {
    p_assignment_id: assignmentId,
    p_status: status,
    p_progress: progress,
    p_note: note,
    p_next_step: nullableText(body.nextStep),
    p_waiting_until: timestampValue(body.waitingUntil)
  });
  if (result.error) return databaseError(result.error);
  await recordActivity(client, user.id, "task", found.data.resource_id, status, "更新交接進度");
  return Response.json({ assignmentId: result.data }, { headers: privateHeaders() });
}

async function resolveTaskHandoff({ client, user }: RequestContext, body: Record<string, unknown>) {
  const assignmentId = uuidValue(body.assignmentId);
  const resolution = enumValue(body.resolution, ["continue","return","close"], null);
  const note = requiredText(body.note, "請輸入今次完成了甚麼，讓下一手知道。");
  if (!assignmentId || !resolution) return jsonError("交接處理方式不正確。", 400);
  if (note instanceof Response) return note;

  const found = await client.from("assignments").select("resource_id,assigned_to_id").eq("id", assignmentId).maybeSingle();
  if (found.error) return databaseError(found.error);
  if (!found.data || found.data.assigned_to_id !== user.id) return jsonError("只有目前跟進者可以完成這一步。", 403);
  const result = await client.rpc("resolve_task_handoff_step", {
    p_assignment_id: assignmentId,
    p_resolution: resolution,
    p_note: note,
    p_next_step: nullableText(body.nextStep),
    p_waiting_until: timestampValue(body.waitingUntil)
  });
  if (result.error) return databaseError(result.error);
  await recordActivity(
    client,
    user.id,
    "task",
    found.data.resource_id,
    resolution === "close" ? "close" : resolution === "return" ? "return" : "step_complete",
    resolution === "close" ? "完全結案" : resolution === "return" ? "完成一步並交回上一手" : "完成一步並繼續跟進"
  );
  return Response.json({ assignmentId: result.data }, { headers: privateHeaders() });
}

async function respondToAssignment({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  const response = enumValue(body.response, ["accept","decline","clarification","alternative_date"], null);
  if (!id || !response) return jsonError("指派回應不正確。", 400);
  const found = await client.from("assignments").select("*").eq("id", id).maybeSingle();
  if (found.error) return databaseError(found.error);
  if (!found.data || found.data.assigned_to_id !== user.id || found.data.status !== "pending_acceptance") return jsonError("這項指派已處理或你沒有權限。", 403);
  const now = new Date().toISOString();
  const changes: Record<string, unknown> = response === "accept"
    ? { status: "accepted", accepted_at: now }
    : response === "decline"
      ? { status: "declined", declined_at: now, decline_reason: nullableText(body.reason) }
      : response === "clarification"
        ? { status: "clarification_requested", clarification_request: nullableText(body.reason) }
        : { status: "alternative_date_proposed", proposed_date: dateValue(body.proposedDate) };
  const result = await client.from("assignments").update(changes).eq("id", id).select("*").single();
  if (result.error) return databaseError(result.error);
  if (response === "accept") {
    const table = found.data.resource_type === "task" ? "tasks" : "operating_items";
    await client.from(table).update({ assignee_id: user.id }).eq("id", found.data.resource_id);
  }
  if (found.data.resource_type === "task") {
    const noteBody = response === "accept"
      ? "接受交接"
      : response === "decline"
        ? nullableText(body.reason) ?? "婉拒交接"
        : response === "clarification"
          ? nullableText(body.reason) ?? "要求補充資料"
          : `建議改期至 ${dateValue(body.proposedDate) ?? "未指定日期"}`;
    const noteResult = await client.from("task_handoff_notes").insert({
      assignment_id: id,
      task_id: found.data.resource_id,
      author_id: user.id,
      event_type: response === "accept" ? "accepted" : response === "decline" ? "declined" : "clarification",
      body: noteBody,
      progress: found.data.progress ?? 0
    });
    if (noteResult.error) return databaseError(noteResult.error);
  }
  await recordActivity(client, user.id, found.data.resource_type, found.data.resource_id, response, "回應指派");
  return Response.json({ assignment: result.data }, { headers: privateHeaders() });
}

async function respondToJoint({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  const accept = Boolean(body.accept);
  if (!id) return jsonError("共同項目邀請不正確。", 400);
  const found = await client.from("joint_memberships").select("*").eq("id", id).maybeSingle();
  if (found.error) return databaseError(found.error);
  if (!found.data || found.data.user_id !== user.id || found.data.accepted_at || found.data.removed_at) return jsonError("邀請已處理或你沒有權限。", 403);
  const result = await client.from("joint_memberships").update(accept ? { accepted_at: new Date().toISOString() } : { removed_at: new Date().toISOString() }).eq("id", id);
  if (result.error) return databaseError(result.error);
  return Response.json({ ok: true }, { headers: privateHeaders() });
}

async function revokeShare({ client, user }: RequestContext, body: Record<string, unknown>) {
  const id = uuidValue(body.id);
  if (!id) return jsonError("分享識別碼不正確。", 400);
  const found = await client.from("share_records").select("*").eq("id", id).maybeSingle();
  if (found.error) return databaseError(found.error);
  if (!found.data || found.data.owner_id !== user.id || found.data.revoked_at) return jsonError("找不到分享或你沒有權限。", 404);
  const now = new Date().toISOString();
  const result = await client.from("share_records").update({ revoked_at: now }).eq("id", id);
  if (result.error) return databaseError(result.error);
  await client.from("assignments").update({ status: "cancelled", cancelled_at: now })
    .eq("resource_type", found.data.resource_type).eq("resource_id", found.data.resource_id).eq("assigned_to_id", found.data.shared_with_user_id)
    .not("status", "in", "(completed,declined,cancelled)");
  await client.from("joint_memberships").update({ removed_at: now })
    .eq("resource_type", found.data.resource_type).eq("resource_id", found.data.resource_id).eq("user_id", found.data.shared_with_user_id).is("removed_at", null);
  await client.from("share_audit_logs").insert({
    resource_type: found.data.resource_type, resource_id: found.data.resource_id, actor_id: user.id,
    target_user_id: found.data.shared_with_user_id, action: "revoke", previous_permission: found.data.permission
  });
  return Response.json({ ok: true }, { headers: privateHeaders() });
}

async function saveSettings({ client, user }: RequestContext, body: Record<string, unknown>) {
  const settings = objectValue(body.settings);
  const payload = pick(settings, ["theme","language","accent_colour","gentle_mode","low_capacity_mode","dashboard_density","wip_limit","quiet_hours_start","quiet_hours_end","notification_mode","default_area","focus_minutes","monthly_profit_target","pinned_pages"]);
  const result = await client.from("user_settings").update(payload).eq("user_id", user.id).select("*").single();
  if (result.error) return databaseError(result.error);
  const displayName = stringValue(body.displayName).trim();
  if (displayName) {
    const profile = await client.from("user_profiles").update({ display_name: displayName }).eq("user_id", user.id);
    if (profile.error) return databaseError(profile.error);
  }
  return Response.json({ settings: result.data }, { headers: privateHeaders() });
}

async function saveCapacity({ client, user }: RequestContext, body: Record<string, unknown>) {
  const energyLevel = enumValue(body.energyLevel, ["low","medium","high"], null);
  if (!energyLevel) return jsonError("請選擇今日能量。", 400);
  const payload = {
    user_id: user.id,
    checkin_date: dateValue(body.date) ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date()),
    energy_level: energyLevel,
    available_minutes: integerValue(body.availableMinutes, 0, 1440),
    mode: enumValue(body.mode, ["normal","gentle","minimum_step","shift"], "normal"),
    essential_only: Boolean(body.essentialOnly),
    notes: nullableText(body.notes)
  };
  const result = await client.from("daily_capacity_checkins").upsert(payload, { onConflict: "user_id,checkin_date" }).select("*").single();
  if (result.error) return databaseError(result.error);
  return Response.json({ capacity: result.data }, { headers: privateHeaders() });
}

async function adminResetPassword({ client, origin }: RequestContext, body: Record<string, unknown>) {
  const email = stringValue(body.email).trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return jsonError("請輸入完整電郵地址。", 422);
  const prepared = await client.rpc("admin_prepare_password_reset", { target_email: email });
  if (prepared.error) {
    if (prepared.error.message.includes("ADMIN_REQUIRED")) return jsonError("只有管理員可以發送密碼重設郵件。", 403);
    if (prepared.error.message.includes("TARGET_NOT_FOUND")) return jsonError("找不到這個已啟用帳戶。", 404);
    return databaseError(prepared.error);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return jsonError("伺服器尚未設定資料庫。", 503);
  const resetClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const reset = await resetClient.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/` });
  if (reset.error) return jsonError("未能發送重設郵件，請稍後再試。", 429);
  return Response.json({ ok: true }, { headers: privateHeaders() });
}

async function search({ client }: RequestContext, query: string) {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return Response.json({ results: [] }, { headers: privateHeaders() });
  const pattern = `%${q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const [tasks, items] = await Promise.all([
    client.from("tasks").select("id,title,area,status,due_date,visibility,owner_id").ilike("title", pattern).limit(20),
    client.from("operating_items").select("id,title,item_type,area,status,due_date,visibility,owner_id").ilike("title", pattern).limit(20)
  ]);
  if (tasks.error) return databaseError(tasks.error);
  if (items.error) return databaseError(items.error);
  const results = [
    ...(tasks.data ?? []).map((item) => ({ ...item, resourceType: "task", itemType: "task" })),
    ...(items.data ?? []).map((item) => ({ ...item, resourceType: "operating_item", itemType: item.item_type }))
  ].slice(0, 30);
  return Response.json({ results }, { headers: privateHeaders() });
}

async function taskCheckpoints({ client, user }: RequestContext, requestedTaskId: string) {
  const taskId = uuidValue(requestedTaskId);
  if (!taskId) return jsonError("任務識別碼不正確。", 400);
  const task = await client.from("tasks").select("id").eq("id", taskId).maybeSingle();
  if (task.error) return databaseError(task.error);
  if (!task.data) return jsonError("找不到任務或你沒有權限查看。", 404);

  const result = await client.from("task_checkpoints")
    .select("*")
    .eq("task_id", taskId)
    .order("last_worked_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(21);
  if (result.error) return databaseError(result.error);
  const rows = result.data ?? [];
  const checkpointIds = rows.map((item) => item.id);
  const resources = checkpointIds.length
    ? await client.from("task_checkpoint_resources")
      .select("checkpoint_id,label,url,position")
      .in("checkpoint_id", checkpointIds)
      .order("position", { ascending: true })
    : { data: [], error: null };
  if (resources.error) return databaseError(resources.error);
  const rowsWithPrivateResources = rows.map((item) => ({
    ...item,
    resource_links: (resources.data ?? [])
      .filter((resource) => resource.checkpoint_id === item.id)
      .map((resource) => ({ label: resource.label, url: resource.url }))
  }));
  const history = rowsWithPrivateResources.filter((item) => item.state === "saved").slice(0, 20);
  return Response.json({
    latest: history[0] ?? null,
    draft: rowsWithPrivateResources.find((item) => item.state === "draft" && item.author_id === user.id) ?? null,
    history
  }, { headers: privateHeaders() });
}

async function saveTaskCheckpoint(
  { client, user }: RequestContext,
  body: Record<string, unknown>,
  state: "draft" | "saved"
) {
  const taskId = uuidValue(body.taskId);
  if (!taskId) return jsonError("任務識別碼不正確。", 400);
  const completedSummary = checkpointText(body.completedSummary, 4000, "剛完成的內容");
  if (completedSummary instanceof Response) return completedSummary;
  const currentPosition = checkpointText(body.currentPosition, 4000, "目前進度");
  if (currentPosition instanceof Response) return currentPosition;
  const nextMinimumStep = checkpointText(body.nextMinimumStep, 2000, "下一個最小步驟");
  if (nextMinimumStep instanceof Response) return nextMinimumStep;
  const blockedReason = checkpointText(body.blockedReason, 2000, "阻塞原因");
  if (blockedReason instanceof Response) return blockedReason;
  const resourceLinks = checkpointResources(body.resourceLinks);
  if (resourceLinks instanceof Response) return resourceLinks;

  const result = await client.rpc("save_task_checkpoint", {
    p_task_id: taskId,
    p_state: state,
    p_completed_summary: completedSummary,
    p_current_position: currentPosition,
    p_next_minimum_step: nextMinimumStep,
    p_resource_links: resourceLinks,
    p_blocked_reason: blockedReason
  });
  if (result.error) return databaseError(result.error);
  const checkpoint = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!checkpoint) return jsonError("未能讀取已儲存的 checkpoint。", 500);
  if (state === "saved") {
    await recordActivity(client, user.id, "task", taskId, "checkpoint_saved", "已儲存工作重啟記錄");
  }
  return Response.json({
    checkpoint: { ...checkpoint, resource_links: resourceLinks }
  }, { headers: privateHeaders() });
}

async function recordActivity(client: SupabaseClient, actorId: string, resourceType: string, resourceId: string, action: string, summary: string) {
  await client.from("activity_logs").insert({ resource_type: resourceType, resource_id: resourceId, actor_id: actorId, action, summary });
}

const itemTypes = [
  "inbox","project","waiting","decision","client","sop","family_member","school","event","important_date","pet","household","shopping",
  "personal_admin","health","vehicle","document","note","goal","routine","finance"
] as const;

function inferDisplayName(user: User) {
  const metadata = user.user_metadata ?? {};
  const value = stringValue(metadata.display_name) || stringValue(metadata.full_name) || stringValue(metadata.name) || user.email?.split("@")[0] || "User";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
function nullableText(value: unknown) { const text = stringValue(value).trim(); return text ? text.slice(0, 10000) : null; }
function requiredText(value: unknown, message: string) { const text = stringValue(value).trim(); return text ? text.slice(0, 500) : jsonError(message, 422); }
function dateValue(value: unknown) { const text = stringValue(value); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null; }
function timestampValue(value: unknown) { const text = stringValue(value).trim(); if (!text) return null; const date = new Date(text); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function integerValue(value: unknown, min: number, max: number) { const number = Number(value); return Number.isInteger(number) && number >= min && number <= max ? number : null; }
function uuidValue(value: unknown) { const text = stringValue(value); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null; }
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function enumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number] | null): T[number] | null { const text = stringValue(value); return allowed.includes(text) ? text as T[number] : fallback; }
function pick(source: Record<string, unknown>, keys: readonly string[]) { return Object.fromEntries(Object.entries(source).filter(([key]) => keys.includes(key))); }
function safeUrl(value: unknown) { const text = stringValue(value).trim(); if (!text) return null; try { const url = new URL(text); return url.protocol === "https:" ? text.slice(0, 2000) : null; } catch { return null; } }
function checkpointText(value: unknown, maxLength: number, label: string) {
  const text = stringValue(value).trim();
  if (text.length > maxLength) return jsonError(`${label}太長，請縮短後再儲存。`, 422);
  return text || null;
}
function checkpointResources(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 10) return jsonError("相關資源格式不正確；最多可加入 10 個連結。", 422);
  const resources: Array<{ label: string; url: string }> = [];
  for (const item of value) {
    const resource = objectValue(item);
    const url = safeUrl(resource.url);
    const label = stringValue(resource.label).trim();
    if (!url || label.length > 200) return jsonError("相關資源必須是有效的 HTTPS 網址。", 422);
    resources.push({ label: label || new URL(url).hostname, url });
  }
  return resources;
}
function inboxProcessingOptions(value: unknown): Record<string, string | number | null> | Response {
  const source = objectValue(value);
  const textLimits: Record<string, number> = {
    title: 500,
    description: 10000,
    nextAction: 5000,
    context: 500,
    notes: 10000,
    handoffNote: 5000
  };
  const result: Record<string, string | number | null> = {};
  for (const [key, maxLength] of Object.entries(textLimits)) {
    const raw = stringValue(source[key]).trim();
    if (raw.length > maxLength) return jsonError("收集箱處理內容太長，請縮短後再試。", 422);
    result[key] = raw || null;
  }

  const area = stringValue(source.area);
  if (area && !["work", "family", "personal"].includes(area)) {
    return jsonError("工作範圍不正確。", 422);
  }
  result.area = area || null;

  const energyLevel = stringValue(source.energyLevel);
  if (energyLevel && !["low", "medium", "high"].includes(energyLevel)) {
    return jsonError("能量需求不正確。", 422);
  }
  result.energyLevel = energyLevel || null;

  for (const key of ["dueDate", "plannedDate"] as const) {
    const raw = stringValue(source[key]);
    if (raw && !dateValue(raw)) return jsonError("日期格式不正確。", 422);
    result[key] = raw || null;
  }

  const estimatedRaw = source.estimatedMinutes;
  if (estimatedRaw === "" || estimatedRaw === null || estimatedRaw === undefined) {
    result.estimatedMinutes = null;
  } else {
    const estimated = integerValue(estimatedRaw, 0, 14400);
    if (estimated === null) return jsonError("預計時間必須是 0 至 14400 分鐘。", 422);
    result.estimatedMinutes = estimated;
  }

  const targetRaw = stringValue(source.handoffToUserId);
  const target = targetRaw ? uuidValue(targetRaw) : null;
  if (targetRaw && !target) return jsonError("交接對象不正確。", 422);
  result.handoffToUserId = target;
  return result;
}
function privateHeaders() { return { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" }; }
function jsonError(message: string, status: number) { return Response.json({ error: message }, { status, headers: privateHeaders() }); }
function databaseError(error: { code?: string; message?: string }) {
  if (error.code === "PGRST205" || error.message?.includes("Could not find the table")) return jsonError("資料庫尚未套用最新 privacy migration。", 503);
  if (error.message?.includes("NEXT_ACTION_REQUIRED")) return jsonError("開始任務前必須設定清晰的下一步。", 422);
  if (error.message?.includes("HANDOFF_NOTE_REQUIRED")) return jsonError("請輸入交接 notes。", 422);
  if (error.message?.includes("TASK_ALREADY_HANDED_OFF")) return jsonError("此任務已經有人跟進，請先完成目前交接。", 409);
  if (error.message?.includes("HANDOFF_TARGET_NOT_CONNECTED")) return jsonError("這位使用者尚未加入你的交接名單。", 422);
  if (error.message?.includes("INVALID_HANDOFF")) return jsonError("交接資料不正確，請重新檢查。", 422);
  if (error.message?.includes("CHECKPOINT_FORBIDDEN")) return jsonError("你沒有權限更新這項任務的工作記錄。", 403);
  if (error.message?.includes("CHECKPOINT_CONTENT_REQUIRED")) return jsonError("請至少填寫目前進度或下一個最小步驟。", 422);
  if (error.message?.includes("CHECKPOINT_RESOURCE_INVALID")) return jsonError("相關資源必須是有效的 HTTPS 網址。", 422);
  if (error.message?.includes("CHECKPOINT_IMMUTABLE")) return jsonError("已儲存的歷史記錄不可覆寫；請新增一筆。", 409);
  if (error.message?.includes("INBOX_PROCESSING_ACTION_INVALID") || error.message?.includes("INBOX_PROCESSING_INVALID")) return jsonError("收集箱處理資料不正確。", 422);
  if (error.message?.includes("INBOX_ITEM_NOT_AVAILABLE")) return jsonError("這項收集箱內容已處理或暫時不可用。", 409);
  if (error.message?.includes("INBOX_NEXT_ACTION_REQUIRED")) return jsonError("請輸入立即開始的下一個最小步驟。", 422);
  if (error.message?.includes("INBOX_DATE_REQUIRED")) return jsonError("請選擇安排日期。", 422);
  if (error.message?.includes("INBOX_HANDOFF_REQUIRED")) return jsonError("請選擇跟進者並輸入交接 notes。", 422);
  if (error.message?.includes("INBOX_UNDO_NOT_AVAILABLE") || error.message?.includes("INBOX_UNDO_EXPIRED")) return jsonError("最近一次處理已超過可安全撤銷的時間。", 409);
  if (error.message?.includes("INBOX_UNDO_NOT_LATEST")) return jsonError("只可撤銷最近一次處理。", 409);
  if (error.message?.includes("INBOX_UNDO_TARGET_CHANGED")) return jsonError("新項目已有進度，為保障資料不會自動撤銷。", 409);
  if (error.message?.includes("INBOX_UNDO_SOURCE_MISSING")) return jsonError("原始收集箱內容已不存在，未有改動其他資料。", 409);
  if (error.message?.includes("AUTH_REQUIRED")) return jsonError("登入已失效，請重新登入。", 401);
  if (error.message?.includes("FORBIDDEN") || error.message?.includes("permission")) return jsonError("操作被權限規則拒絕。", 403);
  return jsonError("資料操作失敗，請稍後再試。", 500);
}
