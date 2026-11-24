import type { SupabaseClient } from "@supabase/supabase-js";

const taskFields = "id,title,area,status,due_date,visibility,owner_id";

export async function findControlResources(client: SupabaseClient, viewerId: string, query: string) {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return { results: [], error: null };
  const pattern = `%${q.replace(/[\\%_*]/g, character => `\\${character}`)}%`;
  // SEC and 恩海居 are one classification. Keep literal title matches too.
  const tagPattern = q === "恩海居" ? "SEC" : pattern;

  // Three bounded reads in parallel under the current user's token. Both task
  // visibility and the viewer's private tag ownership must match; no service client.
  const [titles, tagged, items] = await Promise.all([
    client.from("tasks").select(taskFields).is("deleted_at", null).ilike("title", pattern).order("updated_at", { ascending: false }).limit(20),
    client.from("tasks").select(`${taskFields},matches:task_tag_assignments!inner(tag:personal_task_tags!inner(name))`)
      .is("deleted_at", null).eq("matches.user_id", viewerId).eq("matches.tag.user_id", viewerId)
      .is("matches.tag.deleted_at", null).ilike("matches.tag.name", tagPattern).order("updated_at", { ascending: false }).limit(20),
    client.from("operating_items").select("id,title,item_type,area,status,due_date,visibility,owner_id")
      .neq("item_type", "client").ilike("title", pattern).order("updated_at", { ascending: false }).limit(20)
  ]);
  const error = titles.error ?? tagged.error ?? items.error;
  if (error) return { results: [], error };

  const tasks = new Map<string, Record<string, unknown>>();
  for (const row of titles.data ?? []) tasks.set(row.id, { ...row, resourceType: "task", itemType: "task" });
  for (const { matches, ...row } of tagged.data ?? []) {
    const matchesForTask = matches as unknown as Array<{ tag: { name: string } }>;
    const matchedTags = [...new Set(matchesForTask.map(({ tag }) => tag.name))];
    tasks.set(row.id, { ...row, resourceType: "task", itemType: "task", matchedTags });
  }
  const otherItems = (items.data ?? []).map(item => ({ ...item, resourceType: "operating_item", itemType: item.item_type }));
  // Let note/schedule hits remain discoverable even when a common Tag matches many tasks.
  return { results: [...Array.from(tasks.values()).slice(0, 20), ...otherItems].slice(0, 30), error: null };
}
