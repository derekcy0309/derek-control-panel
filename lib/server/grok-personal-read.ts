import type { SupabaseClient } from "@supabase/supabase-js";
import { appleCalendarMonthWindow, type AppleCalendarMonthWindow, type AppleCalendarMonth } from "../apple-calendar-month.ts";

const WORKSPACE_FIELDS = ["id", "title", "description", "item_type", "status", "area", "due_date", "next_action", "schedule_start_at", "schedule_end_at", "schedule_status", "updated_at"] as const;
const RULE_FIELDS = ["id", "item", "category", "amount", "start_month", "is_active", "updated_at"] as const;
const FAMILY_TYPES = ["event", "important_date", "household", "shopping", "pet"];

// Intentionally not an arbitrary Data API proxy. Schema, owner column, output
// fields, and any permitted constraints are fixed here, never supplied by Grok.
const datasets = {
  tasks: { table: "tasks", fields: ["id", "title", "description", "next_action", "status", "requested_priority", "area", "due_date", "follow_up_date", "planned_date", "work_start_date", "work_dates", "updated_at"], month: "due_date" },
  notes: { table: "operating_items", fields: ["id", "title", "description", "area", "updated_at"], month: null },
  family: { table: "operating_items", fields: WORKSPACE_FIELDS, month: "family" },
  school: { table: "operating_items", fields: WORKSPACE_FIELDS, month: "due_date" },
  calendar: { table: "operating_items", fields: ["id", "title", "area", "schedule_start_at", "schedule_end_at", "schedule_status", "updated_at"], month: "schedule" },
  personal_records: { table: "operating_items", fields: ["id", "title", "item_type", "status", "due_date", "updated_at"], month: "due_date" },
  finance_transactions: { table: "transactions", fields: ["id", "type", "item", "category", "amount", "expected_date", "actual_date", "payment_month", "status", "frequency", "updated_at"], month: "payment" },
  finance_expense_rules: { table: "recurring_expense_rules", fields: [...RULE_FIELDS, "last_payment_month"], month: null },
  finance_income_rules: { table: "recurring_income_rules", fields: [...RULE_FIELDS, "last_receipt_month"], month: null },
  finance_balances: { table: "balances", fields: ["id", "month", "opening_balance", "updated_at"], month: "month" },
  medications: { table: "personal_medication_logs", fields: ["id", "entry_date", "taken_time", "medication", "dosage", "effect", "updated_at"], month: "entry_date" },
  links: { table: "dayline_web_links", fields: ["id", "title", "shelf", "updated_at"], month: null },
  tags: { table: "personal_task_tags", fields: ["id", "name", "updated_at"], month: null },
} as const;

type Dataset = keyof typeof datasets;
type DataQuery = { dataset: Dataset; limit: number; offset: number; window: AppleCalendarMonthWindow | null };
export type GrokReadQuery = DataQuery | { dataset: "icloud"; window: AppleCalendarMonthWindow } | { dataset: "catalog" };
export const grokPersonalReadCatalog = [...Object.entries(datasets).map(([dataset, config]) => ({ dataset, month: config.month !== null ? "optional" : "not_supported" })), { dataset: "icloud", month: "required" }];

const recordUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const scopedWorkspace = new Set<Dataset>(["tasks", "notes", "family", "school", "calendar", "personal_records"]);
const finance = new Set<Dataset>(["finance_transactions", "finance_expense_rules", "finance_income_rules", "finance_balances"]);

// The human calendar helper includes neighboring days in the visible month
// grid. The agent receives exactly the chosen Hong Kong month, with YYYY-MM
// validated and 1 calendar read capped at the provider helper's 500 events.
function exactMonth(month: string): AppleCalendarMonthWindow | null {
  const calendar = appleCalendarMonthWindow(month);
  if (!calendar) return null;
  const from = `${month}-01`;
  const until = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1)).toISOString().slice(0, 10);
  return { month, from, until, start: `${from}T00:00:00+08:00`, end: `${until}T00:00:00+08:00` };
}

export function grokPersonalReadQuery(params: URLSearchParams): GrokReadQuery | null {
  const used = new Set<string>();
  for (const [key] of params) {
    if (!["dataset", "month", "limit", "offset"].includes(key) || used.has(key)) return null;
    used.add(key);
  }
  if (!used.size) return { dataset: "catalog" };
  const ds = params.get("dataset"), month = params.get("month");
  const window = month === null ? null : exactMonth(month);
  if (month !== null && !window) return null;
  if (ds === "icloud") return window && !used.has("limit") && !used.has("offset") ? { dataset: ds, window } : null;
  if (!ds || !Object.hasOwn(datasets, ds)) return null;
  const dataset = ds as Dataset;
  if (window && datasets[dataset].month === null) return null;
  const limit = params.get("limit") ?? "15", offset = params.get("offset") ?? "0";
  if (!/^(?:[1-9]|[12][0-9]|30)$/.test(limit) || !/^(?:0|[1-9][0-9]{0,3})$/.test(offset)) return null;
  return { dataset, limit: Number(limit), offset: Number(offset), window };
}

/** Read only complete rows of the selected dataset; free text is bounded for a compact agent response. */
function project(row: Record<string, unknown>, fields: readonly string[]) {
  const result: Record<string, unknown> = {};
  let textTruncated = false;
  for (const field of fields) {
    const value = row[field];
    const max = field === "description" || field === "effect" ? 4_000 : 1_000;
    if (typeof value === "string" && value.length > max) { result[field] = value.slice(0, max); textTruncated = true; }
    else if (value !== undefined) result[field] = value;
  }
  return textTruncated ? { ...result, textTruncated } : result;
}

export async function readGrokPersonalRows(client: SupabaseClient, ownerId: string, input: DataQuery) {
  if (!recordUuid.test(ownerId)) throw new Error("GROK_PERSONAL_INVALID_OWNER");
  const { dataset, offset, limit, window } = input;
  const config = datasets[dataset];
  const privateWorkspace = scopedWorkspace.has(dataset);
  let query = client.from(config.table).select(config.fields.join(","))
    .eq(privateWorkspace || dataset === "links" ? "owner_id" : "user_id", ownerId);

  if (dataset !== "medications" && dataset !== "tags") query = query.is("archived_at", null);
  if (dataset === "tasks" || dataset === "tags") query = query.is("deleted_at", null);
  if (privateWorkspace) query = query.eq("visibility", "private").eq("created_by_id", ownerId)
    .is("household_id", null).or(`assignee_id.is.null,assignee_id.eq.${ownerId}`);
  if (finance.has(dataset)) query = query.eq("scope", "home"); // Company ledgers are not personal information.
  if (dataset === "notes") query = query.eq("item_type", "note");
  if (dataset === "family") query = query.eq("area", "family").in("item_type", FAMILY_TYPES);
  if (dataset === "school") query = query.eq("area", "family").eq("item_type", "school");
  if (dataset === "calendar") query = query.eq("item_type", "event").in("schedule_status", ["confirmed", "tentative"]);
  if (dataset === "personal_records") query = query.eq("area", "personal").in("item_type", ["health", "document", "vehicle"]);

  if (window && config.month) {
    const { from, until, start, end } = window;
    if (config.month === "schedule") query = query.lt("schedule_start_at", end).gt("schedule_end_at", start);
    else if (config.month === "family") query = query.or(`and(due_date.gte.${from},due_date.lt.${until}),and(schedule_start_at.lt.${end},schedule_end_at.gt.${start})`);
    else if (config.month === "payment") query = query.or(`and(payment_month.gte.${from},payment_month.lt.${until}),and(payment_month.is.null,actual_date.gte.${from},actual_date.lt.${until}),and(payment_month.is.null,actual_date.is.null,expected_date.gte.${from},expected_date.lt.${until})`);
    else query = query.gte(config.month, from).lt(config.month, until);
  }
  const result = await query.order("id", { ascending: true }).range(offset, offset + limit);
  if (result.error || !Array.isArray(result.data)) throw new Error("GROK_PERSONAL_READ_FAILED");
  const page = (result.data as unknown as Record<string, unknown>[]).slice(0, limit);
  const ids = page.map(row => row.id);
  if (ids.some(id => typeof id !== "string" || !recordUuid.test(id))) throw new Error("GROK_PERSONAL_READ_FAILED");

  // Visibility alone does not account for an outstanding assignment, ACL
  // or task follower. The database rechecks these and ownership together just
  // before release; a failed check returns no rows to the agent, never bypasses it.
  let filtered = page;
  if (privateWorkspace && ids.length) {
    const acl = await client.rpc("grok_personal_unshared_ids", { p_owner_id: ownerId, p_kind: dataset, p_record_ids: ids });
    if (acl.error || !Array.isArray(acl.data)) throw new Error("GROK_PERSONAL_ACL_FAILED");
    const allowed = new Set(acl.data as unknown[]);
    filtered = page.filter(row => allowed.has(row.id));
  }
  return {
    dataset, ...(window ? { month: window.month } : {}), items: filtered.map(row => project(row, config.fields)),
    // A fully filtered page may nevertheless have a continuation. Never scan
    // unbounded data on a service credential just to fill a single response.
    nextOffset: result.data.length > limit && offset + limit <= 9_999 ? offset + limit : null,
    ...(result.data.length > limit && offset + limit > 9_999 ? { truncated: true } : {}),
  };
}

export function projectGrokPersonalCalendar(month: AppleCalendarMonth, window: AppleCalendarMonthWindow) {
  const { from, until, start, end } = window;
  return {
    dataset: "icloud", month: window.month, from, untilExclusive: until, timezone: "Asia/Hong_Kong",
    source: { state: month.source.state, lastSync: month.source.lastSync }, truncated: month.truncated,
    items: month.events.filter(event => {
      if (event.allDay) return event.start.slice(0, 10) < until && event.end.slice(0, 10) > from;
      const first = Date.parse(event.start), last = Date.parse(event.end);
      return first < Date.parse(end) && (last === first ? first >= Date.parse(start) : last > Date.parse(start));
    }).map(event => ({ title: event.title.slice(0, 1_000), start: event.start, end: event.end, allDay: event.allDay })),
  };
}
