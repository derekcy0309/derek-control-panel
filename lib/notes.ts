import type { OperatingItem } from "./types.ts";

export const noteCategories = ["車輛", "個人財務", "公司", "工作", "個人", "家庭"] as const;
export const noteCategoryMaxLength = 40;

export function noteCategory(item: Pick<OperatingItem, "metadata">) {
  const value = item.metadata?.noteCategory;
  return typeof value === "string" ? value.trim() : "";
}

export function validateNoteInput(input: { title: unknown; description: unknown; category: unknown }) {
  if (typeof input.title !== "string" || !input.title.trim()) return "請輸入筆記標題。";
  if (input.title.length > 500) return "筆記標題最多 500 字，請縮短標題。";
  if (input.description != null && (typeof input.description !== "string" || input.description.length > 10000)) return "筆記內容最多 10,000 字，請分成兩則筆記。";
  if (input.category != null && (typeof input.category !== "string" || input.category.trim().length > noteCategoryMaxLength)) return "分類最多 40 字，請輸入簡短名稱。";
  return null;
}

/** Categories are labels only; never map them to area, sharing or financial records. */
export function noteMetadata(metadata: Record<string, unknown>, category: string | null | undefined) {
  const next = { ...metadata };
  if (category?.trim()) next.noteCategory = category.trim();
  else delete next.noteCategory;
  return next;
}

export function filterNotes(items: OperatingItem[], query = "", category = "") {
  const search = query.trim().toLocaleLowerCase();
  return items.filter((item) => item.item_type === "note" && !item.archived_at
    && (!category || (category === "__uncategorized" ? !noteCategory(item) : noteCategory(item) === category))
    && (!search || `${item.title} ${item.description ?? ""} ${noteCategory(item)}`.toLocaleLowerCase().includes(search)))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
}

export function noteDraftKey(userId: string, itemId = "new") {
  return `dcp:note-form-draft:v1:${userId}:${itemId}`;
}

export function clearNoteDrafts(storage: Pick<Storage, "length" | "key" | "removeItem">, userId: string) {
  const prefix = `dcp:note-form-draft:v1:${userId}:`;
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) storage.removeItem(key);
  }
}
