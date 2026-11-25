import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { privateJson, type AuthenticatedRequestContext } from "@/lib/server/request-context";
import { activeStartReader } from "@/lib/server/start-reader";

export const dynamic = "force-dynamic";
const saveInput = z.object({
  text: z.string().trim().min(1).max(10000),
  // Use the exact value the client saw, including Postgres microseconds.
  revision: z.string().min(1).max(64).nullable(),
}).strict();
const source = "dayline-working-draft";
const noteCols = "id,description,updated_at,archived_at,area,visibility,sensitive,assignee_id,metadata";
type Context = AuthenticatedRequestContext;

function noteId(account: string, task: string) {
  const h = createHash("sha256").update([source, account, task].join(":")).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), "8" + h.slice(13, 16), "a" + h.slice(17, 20), h.slice(20, 32)].join("-");
}
const unavailable = () => privateJson({ error: "未能讀取私人草稿。請稍後重試。" }, 503);
const conflict = () => privateJson({ error: "另一個畫面已更新草稿。你輸入嘅文字仍喺度；請先複製，再重讀。" }, 409);
async function scope(req: NextRequest) {
  const ctx = await activeStartReader(req);
  if (ctx instanceof Response) return ctx;
  if (req.headers.get("x-dayline-account") !== ctx.user.id) return privateJson({ error: "登入帳戶已變更，請重新整理。" }, 409);
  const tid = z.uuid().safeParse(req.nextUrl.searchParams.get("task"));
  if (!tid.success) return privateJson({ error: "請重新打開呢件任務。" }, 422);
  // Same authenticated client and RLS as the task itself. Titles never come from the requester.
  const task = await ctx.client.from("tasks").select("id,title").eq("id", tid.data).is("deleted_at", null).is("archived_at", null).maybeSingle();
  if (task.error) return unavailable();
  if (!task.data) return privateJson({ error: "未能開啟呢件任務。" }, 404);
  return { ctx, task: task.data, id: noteId(ctx.user.id, tid.data) };
}
async function readNote({ client, user }: Context, id: string, taskId: string) {
  const result = await client.from("operating_items").select(noteCols).eq("id", id).eq("owner_id", user.id).eq("item_type", "note").maybeSingle();
  if (result.error) return unavailable();
  const note = result.data;
  if (!note) return null;
  const sharedError = () => privateJson({ error: "呢份筆記已分享、封存或更改咗設定。請到「筆記」管理；呢度唔會繼續寫入。" }, 409);
  if (note.archived_at || !note.sensitive || note.area !== "personal" || note.visibility !== "private" || note.assignee_id
    || note.metadata?.source !== source || note.metadata?.taskId !== taskId) return sharedError();
  // Sharing a task does not share this unrelated Note. If the owner separately
  // shares/assigns the Note, do not treat it as a private draft any longer.
  const grants = await Promise.all([
    client.from("share_records").select("id").eq("resource_type","operating_item").eq("resource_id",id).is("revoked_at",null).limit(1),
    client.from("assignments").select("id").eq("resource_type","operating_item").eq("resource_id",id).limit(1),
    client.from("joint_memberships").select("id").eq("resource_type","operating_item").eq("resource_id",id).is("removed_at",null).limit(1),
  ]);
  if (grants.some(g => g.error)) return unavailable();
  return grants.some(g => g.data?.length) ? sharedError() : note;
}
export async function GET(req: NextRequest) {
  const access = await scope(req);
  if (access instanceof Response) return access;
  const note = await readNote(access.ctx, access.id, access.task.id);
  if (note instanceof Response) return note;
  return privateJson({ text: note?.description ?? "", revision: note?.updated_at ?? null });
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) return privateJson({ error: "請喺日序儲存草稿。" }, 403);
  if (req.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return privateJson({ error: "格式不正確。" }, 415);
  const body = saveInput.safeParse(await req.json().catch(() => null));
  if (!body.success) return privateJson({ error: "請輸入 1 至 10,000 字嘅草稿。" }, 422);
  const access = await scope(req);
  if (access instanceof Response) return access;
  const { ctx, task, id } = access;
  const existing = await readNote(ctx, id, task.id);
  if (existing instanceof Response) return existing;
  const { text, revision } = body.data;
  if (existing?.description === text) return privateJson({ revision: existing.updated_at });
  if ((existing?.updated_at ?? null) !== revision) return conflict();
  const now = new Date().toISOString();
  const result = existing ? await ctx.client.from("operating_items").update({ description: text, updated_at: now, last_progress_at: now })
    .eq("id",id).eq("owner_id",ctx.user.id).eq("item_type","note").eq("visibility","private").eq("area","personal").eq("sensitive",true)
    .is("archived_at",null).is("assignee_id",null).eq("updated_at",existing.updated_at).select("updated_at").maybeSingle()
    : await ctx.client.from("operating_items").insert({
        id, item_type: "note", title: ("草稿 · " + task.title).slice(0, 250), description: text,
        area: "personal", owner_id: ctx.user.id, created_by_id: ctx.user.id,
        visibility: "private", sensitive: true, status: "active", last_progress_at: now,
        metadata: { source, taskId: task.id, noteCategory: "工作草稿" },
      }).select("updated_at").maybeSingle();
  if (result.error?.code === "23505") return conflict();
  if (result.error) return privateJson({ error: "草稿未能儲存。請保留文字，再試一次。" }, 503);
  if (!result.data?.updated_at) return conflict();
  await ctx.client.from("activity_logs").insert({ resource_type:"operating_item",resource_id:id,actor_id:ctx.user.id,action:existing?"update":"create",summary:"儲存工作草稿" });
  return privateJson({ revision: result.data.updated_at });
}
