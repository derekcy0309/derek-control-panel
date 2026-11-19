import { agentObject, agentUuidPattern, hasOnlyAgentFields } from "./agent-access.ts";

export type SchoolMode = "off" | "redact" | "omit";
export type SchoolChange = { title?: string; date?: string | null };
export type SchoolRow = { id: string; version: string; title: string; date: string | null };
export type SchoolProposal = { id: string; grant_id: string; operation: "create" | "update" | "delete"; before_fields: SchoolChange | null; changes: SchoolChange; expires_at: string };
export type SchoolGrant = { id: string; label: string; mode: SchoolMode };
export const schoolId = (x: unknown): x is string => typeof x === "string" && agentUuidPattern.test(x);
export const schoolMode = (v: unknown): v is SchoolMode => v === "off" || v === "redact" || v === "omit";
const dateOk = (v: unknown) => {
  if (v === null) return true;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const instant = new Date(v + "T00:00:00Z");
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0,10) === v && !v.startsWith("0000");
};
export function validSchoolProposal(value: unknown) {
  const data = agentObject(value), changes = agentObject(data?.changes);
  if (!data || !changes || !hasOnlyAgentFields(data, ["operation","requestId","itemId","version","changes"]) ||
      !hasOnlyAgentFields(changes, ["title","date"]) || !schoolId(data.requestId)) return false;
  if ("title" in changes && (typeof changes.title !== "string" || !changes.title.trim() || [...changes.title].length > 120 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(changes.title))) return false;
  if ("date" in changes && !dateOk(changes.date)) return false;
  if (data.operation === "create") return "title" in changes && !("itemId" in data) && !("version" in data);
  if (!schoolId(data.itemId) || typeof data.version !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(data.version) || !Number.isFinite(Date.parse(data.version))) return false;
  return data.operation === "delete" ? !Object.keys(changes).length : data.operation === "update" && Object.keys(changes).length > 0;
}
export function schoolBriefText(value: unknown) {
  const obj = agentObject(value);
  if (obj?.enabled !== true || !Array.isArray(obj.items)) return "";
  const lines = new Map<string,number>();
  for (const item of obj.items.slice(0,25)) {
    if (!item || !item.date || !dateOk(item.date) || typeof item.title !== "string") continue;
    const line = item.date.slice(5) + " · " + item.title.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu," ").slice(0,120);
    lines.set(line,(lines.get(line) ?? 0)+1);
  }
  return "\n學校 Deadline：" + (lines.size ? "\n"+[...lines].map(([line,n])=>line+(n>1?" ×"+n:"")).join("\n") : "三日內冇事項") + (obj.more ? "\n另有事項，請入 Panel 睇。" : "");
}
