import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { PersonalTaskTag } from "@/lib/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseTaskTagIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20 || value.some((id) => typeof id !== "string" || !uuid.test(id))) return null;
  return [...new Set(value as string[])];
}

export async function readMyTaskTags(client: SupabaseClient, user: Pick<User, "id" | "email">, taskIds: string[] = []) {
  const initialized = await client.rpc("ensure_my_task_tags", { p_keep_legacy: user.email?.toLowerCase() === "derekcy0309@gmail.com" });
  if (initialized.error) return { error: initialized.error, tags: [] as PersonalTaskTag[], byTask: new Map<string, string[]>() };
  const [tags, links] = await Promise.all([
    client.from("personal_task_tags").select("id,name,legacy_key").eq("user_id", user.id).is("deleted_at", null).order("created_at").order("id").limit(60),
    taskIds.length ? client.from("task_tag_assignments").select("task_id,tag_id").eq("user_id", user.id).in("task_id", taskIds).limit(20000)
      : Promise.resolve({ data: [], error: null })
  ]);
  const activeIds = new Set((tags.data ?? []).map((tag) => tag.id));
  const byTask = new Map<string, string[]>();
  for (const link of links.data ?? []) {
    if (activeIds.has(link.tag_id)) byTask.set(link.task_id, [...(byTask.get(link.task_id) ?? []), link.tag_id]);
  }
  return { error: tags.error ?? links.error, tags: (tags.data ?? []) as PersonalTaskTag[], byTask };
}

export async function validateMyTaskTags(client: SupabaseClient, userId: string, ids: string[]) {
  if (!ids.length) return null;
  const result = await client.from("personal_task_tags").select("id").eq("user_id", userId).is("deleted_at", null).in("id", ids);
  if (result.error) return result.error.message;
  return result.data.length === ids.length ? null : "有 Tag 已移除或不屬於你，請重新揀選。";
}
