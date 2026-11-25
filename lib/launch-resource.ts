export type LaunchTarget =
  | { kind: "web" | "item"; label: string; href: string }
  | { kind: "file"; label: string; resourceId: string };

type Row = { id?: unknown; label?: unknown; resource_type?: unknown; url?: unknown; linked_item_id?: unknown; item?: unknown };
const idPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
export function launchHttps(value: unknown) {
  if (typeof value !== "string" || value.length > 2000 || !/^https:\/\//i.test(value) || /[\s\\]/.test(value)) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}

// Inputs are already restricted by the caller's task/resource/item policies.
// Never expose contacts, object paths, or details of unavailable linked items.
export function pickLaunchResource(resources: readonly Row[], ownLinks: readonly Row[], owner: string): LaunchTarget | null {
  for (const row of [...ownLinks, ...resources]) {
    const label = typeof row.label === "string" ? row.label.trim().slice(0, 200) : "";
    if (!label) continue;
    if (row.resource_type === "document" || row.resource_type === "url") {
      const href = launchHttps(row.url);
      if (href) return { kind: "web", href, label };
    }
    if (row.resource_type === "storage_file" && typeof row.id === "string" && idPattern.test(row.id)) {
      return { kind: "file", resourceId: row.id, label };
    }
    const type = row.resource_type;
    if (type !== "document" && type !== "sop" && type !== "note") continue;
    const item = row.item as Record<string,unknown> | null;
    if (!item || typeof item.id !== "string" || !idPattern.test(item.id) || item.id !== row.linked_item_id ||
        item.item_type !== type || item.archived_at || item.area !== (type === "sop" ? "work" : "personal") ||
        (type === "note" ? item.owner_id !== owner : ["completed","cancelled"].includes(String(item.status)))) continue;
    return { kind: "item", href: "/workspace/" + type + "#item-" + item.id, label };
  }
  return null;
}
