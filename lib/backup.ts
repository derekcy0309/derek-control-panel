export const backupFormat = "derek-control-panel-backup";
export const backupVersion = 1;

export type BackupData = {
  tasks: Array<Record<string, unknown>>;
  operatingItems: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
  meetings: Array<Record<string, unknown>>;
  balances: Array<Record<string, unknown>>;
  planning: Array<Record<string, unknown>>;
  capacityCheckins: Array<Record<string, unknown>>;
  checkpoints: Array<Record<string, unknown>>;
  taskSteps: Array<Record<string, unknown>>;
  taskResources: Array<Record<string, unknown>>;
  recurrenceRules: Array<Record<string, unknown>>;
  dependencies: Array<Record<string, unknown>>;
  milestones: Array<Record<string, unknown>>;
  weeklyReviews: Array<Record<string, unknown>>;
  focusSessions: Array<Record<string, unknown>>;
  timeObservations: Array<Record<string, unknown>>;
  notificationPreferences: Array<Record<string, unknown>>;
  personalTaskTags: Array<Record<string, unknown>>;
  taskTagAssignments: Array<Record<string, unknown>>;
  taskTagPreferences: Array<Record<string, unknown>>;
  profile: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
};

export type BackupEnvelope = {
  format: typeof backupFormat;
  version: typeof backupVersion;
  exportedAt: string;
  ownerId: string;
  app: { version: string; environment: string };
  includes: string[];
  excluded: string[];
  data: BackupData;
};

export type BackupPreview = {
  version: number;
  ownerId: string;
  exportedAt: string;
  recordCounts: Record<string, number>;
  conflicts: Array<{ category: string; count: number }>;
  unsupported: Array<{ category: string; count: number; reason: string }>;
  canRestore: boolean;
};

const collectionKeys: Array<keyof Omit<BackupData, "profile" | "settings">> = [
  "tasks", "operatingItems", "transactions", "meetings", "balances", "planning",
  "capacityCheckins", "checkpoints", "taskSteps", "taskResources", "recurrenceRules", "dependencies",
  "milestones", "weeklyReviews", "focusSessions", "timeObservations", "notificationPreferences",
  "personalTaskTags", "taskTagAssignments", "taskTagPreferences"
];

export function emptyBackupData(): BackupData {
  return {
    tasks: [], operatingItems: [], transactions: [], meetings: [], balances: [], planning: [],
    capacityCheckins: [], checkpoints: [], taskSteps: [], taskResources: [], recurrenceRules: [], dependencies: [],
    milestones: [], weeklyReviews: [], focusSessions: [], timeObservations: [], notificationPreferences: [],
    personalTaskTags: [], taskTagAssignments: [], taskTagPreferences: [],
    profile: null, settings: null
  };
}

export function parseBackup(value: unknown, currentUserId: string): { backup: BackupEnvelope | null; error: string | null } {
  const input = objectValue(value);
  if (input.format !== backupFormat || input.version !== backupVersion) {
    return { backup: null, error: "備份格式或版本不支援。請選擇由 Derek Control Panel 匯出的 JSON 檔。" };
  }
  const ownerId = stringValue(input.ownerId);
  if (!isUuid(ownerId) || ownerId !== currentUserId) {
    return { backup: null, error: "此備份不屬於目前登入帳戶，為保護私隱不能還原。" };
  }
  const exportedAt = timestampValue(input.exportedAt);
  if (!exportedAt) return { backup: null, error: "備份時間格式不正確。" };

  const rawData = objectValue(input.data);
  const data = emptyBackupData();
  for (const key of collectionKeys) {
    if (rawData[key] !== undefined && !Array.isArray(rawData[key])) {
      return { backup: null, error: `備份內的 ${key} 必須是資料清單。` };
    }
    const entries = Array.isArray(rawData[key]) ? rawData[key] : [];
    if (entries.length > 10_000 || entries.some((entry) => !isObject(entry))) {
      return { backup: null, error: `備份內的 ${key} 資料不正確或超出安全上限。` };
    }
    data[key] = entries.map((entry) => objectValue(entry));
  }
  const tagError = validateBackupTags(data, currentUserId);
  if (tagError) return { backup: null, error: tagError };
  data.profile = isObject(rawData.profile) ? objectValue(rawData.profile) : null;
  data.settings = isObject(rawData.settings) ? objectValue(rawData.settings) : null;

  return {
    backup: {
      format: backupFormat,
      version: backupVersion,
      exportedAt,
      ownerId,
      app: {
        version: stringValue(objectValue(input.app).version) || "unknown",
        environment: stringValue(objectValue(input.app).environment) || "unknown"
      },
      includes: stringArray(input.includes),
      excluded: stringArray(input.excluded),
      data
    },
    error: null
  };
}

export function backupRecordCounts(data: BackupData) {
  return Object.fromEntries(collectionKeys.map((key) => [key, data[key].length]));
}

function validateBackupTags(data: BackupData, userId: string): string | null {
  const tagIds = new Set<string>();
  const activeNames = new Set<string>();
  for (const tag of data.personalTaskTags) {
    const id = stringValue(tag.id);
    const name = stringValue(tag.name);
    if (!isUuid(id) || tagIds.has(id) || tag.user_id !== userId || !name || Array.from(name).length > 40
      || (tag.deleted_at != null && !timestampValue(tag.deleted_at))
      || (tag.created_at != null && !timestampValue(tag.created_at))
      || (tag.updated_at != null && !timestampValue(tag.updated_at))
      || (tag.legacy_key != null && (typeof tag.legacy_key !== "string" || tag.legacy_key.length > 40))) {
      return "備份內的 Tags 資料不正確；必須是你自己的 Tags，而且名稱不可重複。";
    }
    tagIds.add(id);
    if (tag.deleted_at == null) {
      const key = name.toLowerCase();
      if (activeNames.has(key)) return "備份內有重複的 Tag 名稱，請使用未經修改的 JSON 備份。";
      activeNames.add(key);
    }
  }
  if (activeNames.size > 60) return "備份內最多可有 60 個使用中的 Tags。";
  const links = new Set<string>();
  const perTask = new Map<string, number>();
  for (const link of data.taskTagAssignments) {
    const taskId = stringValue(link.task_id);
    const tagId = stringValue(link.tag_id);
    const key = `${taskId}:${tagId}`;
    if (link.user_id !== userId || !isUuid(taskId) || !tagIds.has(tagId) || links.has(key)) {
      return "備份內的任務 Tags 連結不正確，或包含其他帳戶的資料。";
    }
    links.add(key);
    perTask.set(taskId, (perTask.get(taskId) ?? 0) + 1);
    if (perTask.get(taskId)! > 20) return "每項任務最多可保留 20 個 Tags。";
  }
  if (data.taskTagPreferences.length > 1 || data.taskTagPreferences.some((row) => row.user_id !== userId
    || (row.initialized_at != null && !timestampValue(row.initialized_at)))) {
    return "備份內的 Tags 設定不正確。";
  }
  return null;
}

// Mirrors the add-only SQL restore for the preview. No names or task contents
// are returned to logs, and labels never make an inaccessible task available.
export function planBackupTagRestore(
  data: BackupData,
  existingTags: Array<Record<string, unknown>>,
  existingLinks: Array<Record<string, unknown>>,
  availableTaskIds: Set<string>
) {
  const byId = new Map(existingTags.map((tag) => [String(tag.id), tag]));
  const byName = new Map(existingTags.filter((tag) => !tag.deleted_at).map((tag) => [stringValue(tag.name).toLowerCase(), tag]));
  const mapping = new Map<string, string>();
  let tagAdds = 0, tagConflicts = 0;
  for (const tag of data.personalTaskTags) {
    const id = String(tag.id);
    const current = byId.get(id);
    const sameName = !tag.deleted_at ? byName.get(stringValue(tag.name).toLowerCase()) : undefined;
    const target = current ?? sameName;
    if (target) tagConflicts++; else tagAdds++;
    if (!tag.deleted_at && !target?.deleted_at) mapping.set(id, String(target?.id ?? id));
  }
  const present = new Set(existingLinks.map((link) => `${link.task_id}:${link.tag_id}`));
  const proposed = new Set<string>();
  let linkAdds = 0, linkConflicts = 0, unavailableLinks = 0, deletedTagLinks = 0;
  for (const link of data.taskTagAssignments) {
    if (!availableTaskIds.has(String(link.task_id))) { unavailableLinks++; continue; }
    const tagId = mapping.get(String(link.tag_id));
    if (!tagId) { deletedTagLinks++; continue; }
    const key = `${link.task_id}:${tagId}`;
    if (proposed.has(key)) continue;
    proposed.add(key);
    if (present.has(key)) linkConflicts++; else linkAdds++;
  }
  return { tagAdds, tagConflicts, linkAdds, linkConflicts, unavailableLinks, deletedTagLinks };
}

export function backupTaskCsvRows(data: BackupData) {
  const names = new Map(data.personalTaskTags.filter((tag) => !tag.deleted_at).map((tag) => [String(tag.id), String(tag.name)]));
  const byTask = new Map<string, string[]>();
  for (const link of data.taskTagAssignments) {
    const name = names.get(String(link.tag_id));
    if (!name) continue;
    const taskId = String(link.task_id);
    const labels = byTask.get(taskId) ?? [];
    labels.push(name); byTask.set(taskId, labels);
  }
  return data.tasks.map((task) => ({ ...task, tags: (byTask.get(String(task.id)) ?? []).join("、") }));
}

export function csvText(rows: Array<Record<string, unknown>>, columns: Array<{ key: string; label: string }>) {
  const escape = (value: unknown) => {
    const raw = value === null || value === undefined ? "" : String(value);
    // CSV cells beginning with a formula marker must remain plain text when a
    // backup is opened in spreadsheet software.
    const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    columns.map((column) => escape(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column.key])).join(","))
  ].join("\r\n");
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
export function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
export function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
export function timestampValue(value: unknown) {
  const text = stringValue(value);
  const date = new Date(text);
  return text && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 200)).slice(0, 100) : [];
}
