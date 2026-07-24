import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import {
  backupFormat,
  backupRecordCounts,
  backupVersion,
  csvText,
  parseBackup,
  type BackupData,
  type BackupEnvelope
} from "@/lib/backup";

export const dynamic = "force-dynamic";

const maxCollectionSize = 10_000;
const maxRequestBytes = 5 * 1024 * 1024;
const restoreTables = [
  { key: "operatingItems", table: "operating_items", ownerColumn: "owner_id" },
  { key: "tasks", table: "tasks", ownerColumn: "owner_id" },
  { key: "transactions", table: "transactions", ownerColumn: "user_id" },
  { key: "meetings", table: "meetings", ownerColumn: "user_id" },
  { key: "balances", table: "balances", ownerColumn: "user_id" },
  { key: "capacityCheckins", table: "daily_capacity_checkins", ownerColumn: "user_id" },
  { key: "checkpoints", table: "task_checkpoints", ownerColumn: "author_id" },
  { key: "taskResources", table: "task_resources", ownerColumn: "owner_id" },
  { key: "dependencies", table: "task_dependencies", ownerColumn: "created_by_id" },
  { key: "milestones", table: "project_milestones", ownerColumn: "created_by_id" },
  { key: "weeklyReviews", table: "weekly_reviews", ownerColumn: "user_id" }
] as const;

type RequestContext = { client: SupabaseClient; user: User };

export async function GET(request: NextRequest) {
  const context = await authenticate(request);
  if (context instanceof Response) return context;

  const backup = await buildBackup(context);
  if (backup instanceof Response) return backup;
  const audit = await writeAudit(context.client, context.user.id, "export", backup.exportedAt, backupRecordCounts(backup.data));
  if (audit) return audit;

  const format = request.nextUrl.searchParams.get("format") ?? "json";
  if (format === "json") {
    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        ...privateHeaders(),
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="derek-control-panel-backup-${dateStamp()}.json"`
      }
    });
  }

  if (format !== "csv") return jsonError("不支援的匯出格式。", 400);
  const kind = request.nextUrl.searchParams.get("kind") ?? "tasks";
  const report = kind === "finance"
    ? csvText([
      ...backup.data.transactions.map((row) => ({ ...row, record_type: "transaction" })),
      ...backup.data.balances.map((row) => ({ ...row, record_type: "opening_balance" }))
    ], [
      { key: "record_type", label: "類型" }, { key: "scope", label: "範圍" }, { key: "type", label: "收支類型" },
      { key: "item", label: "項目" }, { key: "category", label: "分類" }, { key: "amount", label: "金額" },
      { key: "expected_date", label: "預計日期" }, { key: "actual_date", label: "實際日期" },
      { key: "month", label: "月份" }, { key: "opening_balance", label: "期初結餘" }, { key: "status", label: "狀態" }
    ])
    : csvText(backup.data.tasks, [
      { key: "title", label: "任務" }, { key: "area", label: "範圍" }, { key: "status", label: "狀態" },
      { key: "due_date", label: "到期日" }, { key: "next_action", label: "下一步" },
      { key: "estimated_minutes", label: "預計分鐘" }, { key: "actual_minutes", label: "實際分鐘" },
      { key: "risk", label: "風險" }
    ]);
  const filename = kind === "finance" ? "finance" : "tasks";
  return new Response(report, {
    headers: {
      ...privateHeaders(),
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="derek-control-panel-${filename}-${dateStamp()}.csv"`
    }
  });
}

export async function POST(request: NextRequest) {
  const context = await authenticate(request);
  if (context instanceof Response) return context;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxRequestBytes) return jsonError("備份檔過大，請使用不超過 5 MB 的 JSON 備份。", 413);

  const raw = await request.text();
  if (raw.length > maxRequestBytes) return jsonError("備份檔過大，請使用不超過 5 MB 的 JSON 備份。", 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { return jsonError("備份檔不是有效的 JSON。", 400); }
  const action = body.action;
  if (action !== "preview" && action !== "restore") return jsonError("不支援的備份操作。", 400);

  const parsed = parseBackup(body.backup, context.user.id);
  if (!parsed.backup) return jsonError(parsed.error ?? "備份資料不正確。", 422);

  if (action === "preview") {
    const preview = await previewBackup(context, parsed.backup);
    if (preview instanceof Response) return preview;
    const audit = await writeAudit(context.client, context.user.id, "preview", parsed.backup.exportedAt, preview.recordCounts);
    if (audit) return audit;
    return Response.json(preview, { headers: privateHeaders() });
  }

  if (body.confirmation !== "RESTORE" || body.acknowledged !== true) {
    return jsonError("請閱讀預覽並確認「只新增、不覆蓋」後才可還原。", 422);
  }
  const restored = await context.client.rpc("restore_backup_v1", { p_backup: restorePayload(parsed.backup) });
  if (restored.error) return databaseError(restored.error);
  return Response.json({ restored: restored.data ?? {} }, { headers: privateHeaders() });
}

async function buildBackup({ client, user }: RequestContext): Promise<BackupEnvelope | Response> {
  const [profile, settings, tasks, operatingItems, transactions, meetings, balances, planning, capacityCheckins, weeklyReviews, notificationPreferences, recurrenceRules] = await Promise.all([
    client.from("user_profiles").select("user_id,display_name,timezone,active,created_at,updated_at").eq("user_id", user.id).maybeSingle(),
    client.from("user_settings").select("daily_reminder_time,default_reminder_days,theme,language,accent_colour,gentle_mode,low_capacity_mode,dashboard_density,wip_limit,quiet_hours_start,quiet_hours_end,notification_mode,default_area,focus_minutes,monthly_profit_target,pinned_pages,created_at,updated_at").eq("user_id", user.id).maybeSingle(),
    client.from("tasks").select("*").eq("owner_id", user.id).order("created_at", { ascending: true }).limit(maxCollectionSize),
    client.from("operating_items").select("*").eq("owner_id", user.id).order("created_at", { ascending: true }).limit(maxCollectionSize),
    client.from("transactions").select("*").eq("user_id", user.id).order("created_at", { ascending: true }).limit(maxCollectionSize),
    client.from("meetings").select("*").eq("user_id", user.id).order("created_at", { ascending: true }).limit(maxCollectionSize),
    client.from("balances").select("*").eq("user_id", user.id).order("created_at", { ascending: true }).limit(maxCollectionSize),
    client.from("user_planning_metadata").select("*").eq("user_id", user.id).limit(maxCollectionSize),
    client.from("daily_capacity_checkins").select("*").eq("user_id", user.id).order("checkin_date", { ascending: true }).limit(maxCollectionSize),
    client.from("weekly_reviews").select("*").eq("user_id", user.id).order("week_start", { ascending: true }).limit(maxCollectionSize),
    client.from("notification_preferences").select("*").eq("user_id", user.id).maybeSingle(),
    client.from("task_recurrence_rules").select("*").eq("owner_id", user.id).order("created_at", { ascending: true }).limit(maxCollectionSize)
  ]);
  const firstError = [profile, settings, tasks, operatingItems, transactions, meetings, balances, planning, capacityCheckins, weeklyReviews, notificationPreferences, recurrenceRules].find((result) => result.error)?.error;
  if (firstError) return databaseError(firstError);

  const taskIds = (tasks.data ?? []).map((row) => String(row.id));
  const itemIds = (operatingItems.data ?? []).map((row) => String(row.id));
  const [checkpoints, taskResources, dependencies, milestones, focusSessions, timeObservations] = await Promise.all([
    byIds(client, "task_checkpoints", "task_id", taskIds, "author_id", user.id),
    byIds(client, "task_resources", "task_id", taskIds, "owner_id", user.id),
    byIds(client, "task_dependencies", "task_id", taskIds, "created_by_id", user.id),
    byIds(client, "project_milestones", "project_id", itemIds, "created_by_id", user.id),
    byIds(client, "focus_sessions", "task_id", taskIds, "user_id", user.id),
    byIds(client, "task_time_observations", "task_id", taskIds, "user_id", user.id)
  ]);
  const relatedError = [checkpoints, taskResources, dependencies, milestones, focusSessions, timeObservations].find((result) => result.error)?.error;
  if (relatedError) return databaseError(relatedError);

  const data: BackupData = {
    tasks: rows(tasks.data), operatingItems: rows(operatingItems.data), transactions: rows(transactions.data),
    meetings: rows(meetings.data), balances: rows(balances.data), planning: rows(planning.data),
    capacityCheckins: rows(capacityCheckins.data), checkpoints: rows(checkpoints.data), taskResources: rows(taskResources.data),
    recurrenceRules: rows(recurrenceRules.data), dependencies: rows(dependencies.data).filter((row) => taskIds.includes(String(row.depends_on_task_id))),
    milestones: rows(milestones.data), weeklyReviews: rows(weeklyReviews.data), focusSessions: rows(focusSessions.data),
    timeObservations: rows(timeObservations.data), notificationPreferences: notificationPreferences.data ? [record(notificationPreferences.data)] : [],
    profile: profile.data ? record(profile.data) : null, settings: settings.data ? record(settings.data) : null
  };
  return {
    format: backupFormat,
    version: backupVersion,
    exportedAt: new Date().toISOString(),
    ownerId: user.id,
    app: {
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
      environment: process.env.NEXT_PUBLIC_APP_ENV ?? "unknown"
    },
    includes: [
      "本人擁有的任務、工作項目、財務、會議、容量與週檢視資料",
      "本人撰寫的 Restart Checkpoint、非 Storage 的資源資料、依賴與里程碑",
      "個人設定及通知偏好（只供參考，不會於還原時套用）"
    ],
    excluded: [
      "另一位使用者的資料、分享／交接／指派紀錄及共享權限",
      "登入憑證、密碼、Auth 資料、推送訂閱、通知送達紀錄及 audit log",
      "Supabase Storage 檔案、快速收集的附件二進位內容及檔案本體"
    ],
    data
  };
}

async function previewBackup({ client, user }: RequestContext, backup: BackupEnvelope) {
  const conflicts: Array<{ category: string; count: number }> = [];
  for (const source of restoreTables) {
    const records = backup.data[source.key] as Array<Record<string, unknown>>;
    const ids = records.map((row) => typeof row.id === "string" ? row.id : "").filter(Boolean);
    const count = await existingCount(client, source.table, source.ownerColumn, user.id, ids);
    if (count instanceof Response) return count;
    if (count) conflicts.push({ category: source.key, count });
  }
  const fileResources = backup.data.taskResources.filter((row) => Boolean(row.storage_bucket || row.storage_path)).length;
  const activeTaskIds = activeTaskIdSet(backup);
  const inactiveCheckpoints = backup.data.checkpoints.filter((row) => !activeTaskIds.has(String(row.task_id))).length;
  const inactiveResources = backup.data.taskResources.filter((row) => !activeTaskIds.has(String(row.task_id))).length;
  const unsupported = [
    backup.data.recurrenceRules.length ? { category: "recurrenceRules", count: backup.data.recurrenceRules.length, reason: "重複規則會保留在備份中；V1 不會自動重啟它們，以免產生重複任務。" } : null,
    backup.data.focusSessions.length ? { category: "focusSessions", count: backup.data.focusSessions.length, reason: "Focus 歷史保留在備份中，暫不重建以避免把舊時段誤當成正在進行。" } : null,
    backup.data.timeObservations.length ? { category: "timeObservations", count: backup.data.timeObservations.length, reason: "舊估時觀察保留在備份中；還原任務後系統會重新累積個人估時資料。" } : null,
    backup.data.notificationPreferences.length ? { category: "notificationPreferences", count: backup.data.notificationPreferences.length, reason: "通知和裝置設定不會被還原，避免改變目前裝置的授權。" } : null,
    backup.data.profile ? { category: "profile", count: 1, reason: "帳戶身分與權限不會被備份還原。" } : null,
    backup.data.settings ? { category: "settings", count: 1, reason: "目前 Settings 保持不變，避免覆蓋現有個人偏好。" } : null,
    fileResources ? { category: "taskResources.storage", count: fileResources, reason: "Storage 檔案本體不在 JSON 備份內；相應資源不會還原為失效連結。" } : null,
    inactiveCheckpoints ? { category: "checkpoints.archived", count: inactiveCheckpoints, reason: "已封存或刪除任務的 checkpoint 會留在 JSON，不會令已關閉任務重新開啟。" } : null,
    inactiveResources ? { category: "taskResources.archived", count: inactiveResources, reason: "已封存或刪除任務的資源會留在 JSON，不會令已關閉任務重新開啟。" } : null
  ].filter((value): value is { category: string; count: number; reason: string } => Boolean(value));
  const counts = backupRecordCounts(backup.data);
  const restorableTaskResources = backup.data.taskResources.filter((row) => activeTaskIds.has(String(row.task_id)) && !row.storage_bucket && !row.storage_path).length;
  const restoreCount = Object.entries(counts)
    .filter(([key]) => (restoreTables.some((table) => table.key === key) || key === "planning") && key !== "checkpoints" && key !== "taskResources")
    .reduce((total, [, count]) => total + count, 0) + (backup.data.checkpoints.length - inactiveCheckpoints) + restorableTaskResources;
  return {
    version: backup.version,
    ownerId: backup.ownerId,
    exportedAt: backup.exportedAt,
    recordCounts: counts,
    conflicts,
    unsupported,
    canRestore: restoreCount > 0
  };
}

function restorePayload(backup: BackupEnvelope): BackupEnvelope {
  const activeTaskIds = activeTaskIdSet(backup);
  return {
    ...backup,
    data: {
      ...backup.data,
      checkpoints: backup.data.checkpoints.filter((row) => activeTaskIds.has(String(row.task_id))),
      taskResources: backup.data.taskResources.filter((row) => activeTaskIds.has(String(row.task_id)))
    }
  };
}

function activeTaskIdSet(backup: BackupEnvelope) {
  return new Set(backup.data.tasks
    .filter((task) => !task.archived_at && !task.deleted_at)
    .map((task) => String(task.id)));
}

async function byIds(client: SupabaseClient, table: string, foreignKey: string, ids: string[], ownerColumn: string, userId: string) {
  if (!ids.length) return { data: [] as Array<Record<string, unknown>>, error: null };
  const result = await client.from(table).select("*").in(foreignKey, ids).eq(ownerColumn, userId).limit(maxCollectionSize);
  return { data: result.data ?? [], error: result.error };
}

async function existingCount(client: SupabaseClient, table: string, ownerColumn: string, userId: string, ids: string[]): Promise<number | Response> {
  let total = 0;
  for (let index = 0; index < ids.length; index += 200) {
    const result = await client.from(table).select("id").eq(ownerColumn, userId).in("id", ids.slice(index, index + 200));
    if (result.error) return databaseError(result.error);
    total += result.data?.length ?? 0;
  }
  return total;
}

async function writeAudit(client: SupabaseClient, userId: string, eventKind: "export" | "preview", exportedAt: string, recordCounts: Record<string, number>) {
  const result = await client.from("backup_restore_audit_logs").insert({
    user_id: userId,
    event_kind: eventKind,
    backup_exported_at: exportedAt,
    record_counts: recordCounts
  });
  return result.error ? databaseError(result.error) : null;
}

async function authenticate(request: NextRequest): Promise<RequestContext | Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.cookies.get("dcp_access")?.value ?? "";
  if (!url || !key) return jsonError("伺服器尚未設定資料庫。", 503);
  if (!token) return jsonError("登入已失效，請重新登入。", 401);
  const client = createClient(url, key, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return jsonError("登入已失效，請重新登入。", 401);
  return { client, user: data.user };
}

function rows(value: unknown) { return Array.isArray(value) ? value.map(record) : []; }
function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function dateStamp() { return new Date().toISOString().slice(0, 10).replaceAll("-", ""); }
function privateHeaders() { return { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" }; }
function jsonError(message: string, status: number) { return Response.json({ error: message }, { status, headers: privateHeaders() }); }
function databaseError(error: { code?: string; message?: string }) {
  if (error.code === "PGRST205" || error.message?.includes("Could not find the table") || error.message?.includes("restore_backup_v1")) return jsonError("資料庫尚未套用最新 Backup／Restore migration。", 503);
  if (error.message?.includes("AUTH_REQUIRED")) return jsonError("登入已失效，請重新登入。", 401);
  if (error.message?.includes("BACKUP_INVALID")) return jsonError("備份資料未能通過安全驗證。", 422);
  return jsonError("未能安全完成備份操作，請稍後重試。", 500);
}
