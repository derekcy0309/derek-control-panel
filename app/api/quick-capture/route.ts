import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const captureBucket = "dcp-private-captures";
const maxFileBytes = 12 * 1024 * 1024;
const acceptedContentTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav"
]);

type RequestContext = { client: SupabaseClient; user: User };

export async function POST(request: NextRequest) {
  const context = await authenticate(request);
  if (context instanceof Response) return context;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("收集內容格式不正確。", 400);
  }

  const clientCaptureId = uuidValue(form.get("clientCaptureId"));
  const title = textValue(form.get("title"), 500);
  const description = textValue(form.get("description"), 10000);
  const area = enumValue(form.get("area"), ["work", "family", "personal"] as const, "personal");
  const source = enumValue(form.get("source"), ["text", "voice", "photo", "document", "web"] as const, "text");
  const targetUserId = optionalUuid(form.get("targetUserId"));
  const sourceUrl = optionalHttpsUrl(form.get("sourceUrl"));
  const file = form.get("file");
  const clientFileId = optionalUuid(form.get("clientFileId"));
  const rawAudioRetained = form.get("rawAudioRetained") === "true";

  if (!clientCaptureId || !title) return jsonError("請輸入一句可辨識的內容。", 422);
  if (form.get("targetUserId") && !targetUserId) return jsonError("後續處理者不正確。", 422);
  if (form.get("sourceUrl") && !sourceUrl) return jsonError("分享網址必須是有效的 HTTPS 網址。", 422);
  if (file !== null && (!(file instanceof File) || !clientFileId)) return jsonError("附件資料不正確，請重新選擇檔案。", 422);

  const created = await context.client.rpc("create_mobile_capture", {
    p_client_capture_id: clientCaptureId,
    p_title: title,
    p_description: description,
    p_area: area,
    p_source: source,
    p_target_user_id: targetUserId,
    p_source_url: sourceUrl
  });
  if (created.error) return databaseError(created.error);
  const item = Array.isArray(created.data) ? created.data[0] : created.data;
  if (!item?.id) return jsonError("未能建立收集箱項目。", 500);
  if (!(file instanceof File)) return Response.json({ item, uploaded: false }, { status: 201, headers: privateHeaders() });

  const fileError = validateFile(file);
  if (fileError) return Response.json({ error: fileError, itemId: item.id, retryable: true }, { status: 422, headers: privateHeaders() });

  const existing = await context.client.from("inbox_capture_files")
    .select("id,inbox_item_id,object_path,file_name,content_type,byte_size,file_kind,raw_audio_retained,created_at")
    .eq("owner_id", context.user.id)
    .eq("client_file_id", clientFileId)
    .maybeSingle();
  if (existing.error) return databaseError(existing.error);
  if (existing.data) {
    if (existing.data.inbox_item_id !== item.id) return jsonError("附件重試識別碼不正確。", 409);
    return Response.json({ item, attachment: existing.data, uploaded: true, deduplicated: true }, { status: 200, headers: privateHeaders() });
  }

  const fileKind = file.type.startsWith("image/") ? "photo" : file.type.startsWith("audio/") ? "audio" : "document";
  const objectPath = context.user.id + "/" + clientCaptureId + "/" + clientFileId + "-" + safeFileName(file.name);
  const bytes = Buffer.from(await file.arrayBuffer());
  const uploaded = await context.client.storage.from(captureBucket).upload(objectPath, bytes, {
    contentType: file.type,
    upsert: false
  });
  const alreadyUploaded = Boolean(uploaded.error && /already exists|duplicate/i.test(uploaded.error.message));
  if (uploaded.error && !alreadyUploaded) {
    return Response.json({
      error: "附件未能上載；收集箱文字已安全保留，可按重試而不會建立重複項目。",
      itemId: item.id,
      retryable: true
    }, { status: 503, headers: privateHeaders() });
  }

  const saved = await context.client.from("inbox_capture_files").insert({
    inbox_item_id: item.id,
    owner_id: context.user.id,
    client_file_id: clientFileId,
    bucket_id: captureBucket,
    object_path: objectPath,
    file_name: file.name.slice(0, 255),
    content_type: file.type,
    byte_size: file.size,
    file_kind: fileKind,
    raw_audio_retained: rawAudioRetained && fileKind === "audio"
  }).select("id,inbox_item_id,object_path,file_name,content_type,byte_size,file_kind,raw_audio_retained,created_at").single();
  if (saved.error) return databaseError(saved.error);

  const metadata = objectValue(item.metadata);
  const capture = objectValue(metadata.mobileCapture);
  await context.client.from("operating_items").update({
    metadata: { ...metadata, mobileCapture: { ...capture, hasAttachment: true } },
    last_progress_at: new Date().toISOString()
  }).eq("id", item.id);

  return Response.json({ item, attachment: saved.data, uploaded: true }, { status: 201, headers: privateHeaders() });
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

function validateFile(file: File) {
  if (!file.name || file.name.length > 255 || file.size < 1 || file.size > maxFileBytes) return "附件必須介乎 1 byte 至 12 MB。";
  if (!acceptedContentTypes.has(file.type)) return "目前只支援相片、PDF／Word／文字文件，以及常見音訊檔。";
  return "";
}
function textValue(value: FormDataEntryValue | null, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : null;
}
function uuidValue(value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}
function optionalUuid(value: FormDataEntryValue | null) { return !value ? null : uuidValue(value); }
function optionalHttpsUrl(value: FormDataEntryValue | null) {
  if (!value) return null;
  const text = typeof value === "string" ? value.trim() : "";
  try { return new URL(text).protocol === "https:" && text.length <= 2000 ? text : null; } catch { return null; }
}
function enumValue<T extends readonly string[]>(value: FormDataEntryValue | null, allowed: T, fallback: T[number]) {
  return typeof value === "string" && allowed.includes(value) ? value as T[number] : fallback;
}
function safeFileName(value: string) {
  const cleaned = value.normalize("NFKC").replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_").slice(-120);
  return cleaned || "capture";
}
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function privateHeaders() { return { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" }; }
function jsonError(message: string, status: number) { return Response.json({ error: message }, { status, headers: privateHeaders() }); }
function databaseError(error: { code?: string; message?: string }) {
  if (error.code === "PGRST205" || error.message?.includes("Could not find the table")) return jsonError("資料庫尚未套用最新 Mobile Capture migration。", 503);
  if (error.message?.includes("MOBILE_CAPTURE_TITLE_REQUIRED")) return jsonError("請輸入一句可辨識的內容。", 422);
  if (error.message?.includes("MOBILE_CAPTURE_TARGET_INVALID")) return jsonError("這位後續處理者未加入 Derek／Suki 信任連線。", 422);
  if (error.message?.includes("MOBILE_CAPTURE_INVALID")) return jsonError("快速收集資料不正確。", 422);
  if (error.message?.includes("AUTH_REQUIRED")) return jsonError("登入已失效，請重新登入。", 401);
  return jsonError("未能安全儲存收集內容，請重試。", 500);
}
