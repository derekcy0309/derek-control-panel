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
  taskResources: Array<Record<string, unknown>>;
  recurrenceRules: Array<Record<string, unknown>>;
  dependencies: Array<Record<string, unknown>>;
  milestones: Array<Record<string, unknown>>;
  weeklyReviews: Array<Record<string, unknown>>;
  focusSessions: Array<Record<string, unknown>>;
  timeObservations: Array<Record<string, unknown>>;
  notificationPreferences: Array<Record<string, unknown>>;
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
  "capacityCheckins", "checkpoints", "taskResources", "recurrenceRules", "dependencies",
  "milestones", "weeklyReviews", "focusSessions", "timeObservations", "notificationPreferences"
];

export function emptyBackupData(): BackupData {
  return {
    tasks: [], operatingItems: [], transactions: [], meetings: [], balances: [], planning: [],
    capacityCheckins: [], checkpoints: [], taskResources: [], recurrenceRules: [], dependencies: [],
    milestones: [], weeklyReviews: [], focusSessions: [], timeObservations: [], notificationPreferences: [],
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
    const entries = Array.isArray(rawData[key]) ? rawData[key] : [];
    if (entries.length > 10_000 || entries.some((entry) => !isObject(entry))) {
      return { backup: null, error: `備份內的 ${key} 資料不正確或超出安全上限。` };
    }
    data[key] = entries.map((entry) => objectValue(entry));
  }
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
