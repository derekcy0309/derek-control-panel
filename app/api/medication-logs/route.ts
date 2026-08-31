import { NextRequest } from "next/server";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";
import { medicationPresets } from "@/lib/medication-records";

export const dynamic = "force-dynamic";

type MedicationPayload = {
  id?: string;
  entryDate?: string;
  medication?: string;
  otherMedication?: string;
  dosage?: string;
  effect?: string;
  records?: MedicationEntryPayload[];
};

type MedicationEntryPayload = Pick<MedicationPayload, "medication" | "otherMedication" | "dosage" | "effect">;

export async function GET(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const result = await context.client
    .from("personal_medication_logs")
    .select("id,entry_date,medication,dosage,effect,created_at,updated_at")
    .eq("user_id", context.user.id)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (result.error) return privateJson({ error: "未能讀取藥物紀錄。" }, 500);
  return privateJson({ records: result.data ?? [] });
}

export async function POST(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const payload = await request.json().catch(() => null) as MedicationPayload | null;
  const entryDate = validateDate(payload);
  if (entryDate instanceof Response) return entryDate;
  const drafts = Array.isArray(payload?.records) ? payload.records : [payload ?? {}];
  if (!drafts.length || drafts.length > 20) return privateJson({ error: "每次請儲存 1 至 20 項藥物紀錄。" }, 422);
  const values: Array<{ medication: string; dosage: string; effect: string | null }> = [];
  for (const draft of drafts) {
    const value = validateEntry(draft);
    if (value instanceof Response) return value;
    values.push(value);
  }
  const inserted = await context.client.from("personal_medication_logs").insert(values.map((value) => ({
    user_id: context.user.id,
    entry_date: entryDate,
    medication: value.medication,
    dosage: value.dosage,
    effect: value.effect
  }))).select("id,entry_date,medication,dosage,effect,created_at,updated_at");
  if (inserted.error) return privateJson({ error: "未能儲存藥物紀錄，資料未有遺失。請再試一次。" }, 500);
  return privateJson({ records: inserted.data ?? [] }, 201);
}

export async function PATCH(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const payload = await request.json().catch(() => null) as MedicationPayload | null;
  const id = typeof payload?.id === "string" && /^[0-9a-f-]{36}$/i.test(payload.id) ? payload.id : "";
  if (!id) return privateJson({ error: "藥物紀錄識別碼不正確。" }, 422);
  const entryDate = validateDate(payload);
  if (entryDate instanceof Response) return entryDate;
  const values = validateEntry(payload);
  if (values instanceof Response) return values;
  const updated = await context.client.from("personal_medication_logs").update({
    entry_date: entryDate,
    medication: values.medication,
    dosage: values.dosage,
    effect: values.effect
  }).eq("id", id).eq("user_id", context.user.id)
    .select("id,entry_date,medication,dosage,effect,created_at,updated_at").maybeSingle();
  if (updated.error) return privateJson({ error: "未能更新藥物紀錄。" }, 500);
  if (!updated.data) return privateJson({ error: "找不到藥物紀錄或你沒有權限修改。" }, 404);
  return privateJson({ record: updated.data });
}

export async function DELETE(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return privateJson({ error: "藥物紀錄識別碼不正確。" }, 422);
  const removed = await context.client.from("personal_medication_logs").delete().eq("id", id).eq("user_id", context.user.id).select("id").maybeSingle();
  if (removed.error) return privateJson({ error: "未能刪除藥物紀錄。" }, 500);
  if (!removed.data) return privateJson({ error: "找不到藥物紀錄或你沒有權限刪除。" }, 404);
  return privateJson({ ok: true });
}

function validateDate(payload: MedicationPayload | null) {
  const entryDate = typeof payload?.entryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.entryDate) ? payload.entryDate : "";
  if (!entryDate) return privateJson({ error: "請選擇日期。" }, 422);
  return entryDate;
}

function validateEntry(payload: MedicationEntryPayload | MedicationPayload | null) {
  const selected = typeof payload?.medication === "string" ? payload.medication.trim() : "";
  const otherMedication = typeof payload?.otherMedication === "string" ? payload.otherMedication.trim().slice(0, 120) : "";
  const medication = selected === "其他藥物" ? otherMedication : selected;
  const dosage = typeof payload?.dosage === "string" ? payload.dosage.trim().slice(0, 80) : "";
  const effect = typeof payload?.effect === "string" ? payload.effect.trim().slice(0, 2_000) : "";
  if (!medication) return privateJson({ error: "請選擇或輸入藥物名稱。" }, 422);
  if (selected !== "其他藥物" && !medicationPresets.includes(selected as typeof medicationPresets[number])) return privateJson({ error: "藥物名稱不正確。" }, 422);
  if (!dosage) return privateJson({ error: "請輸入劑量。" }, 422);
  return { medication, dosage, effect: effect || null };
}
