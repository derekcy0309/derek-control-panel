"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { controlAction } from "@/lib/control-api";
import { noteCategories, noteCategory, noteCategoryMaxLength, noteDraftKey, validateNoteInput } from "@/lib/notes";
import type { OperatingItem } from "@/lib/types";

export function NoteEditor({ item, userId, categorySuggestions = [], onClose, onSaved }: {
  item: OperatingItem | null;
  userId: string;
  categorySuggestions?: string[];
  onClose: () => void;
  onSaved: (item: OperatingItem) => void;
}) {
  const [form, setForm] = useState({ title: item?.title ?? "", description: item?.description ?? "", category: item ? noteCategory(item) : "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const inFlight = useRef(false);
  const saved = useRef(false);
  const categoryListId = useId();
  const titleId = useId();
  const contentId = useId();
  const categoryId = useId();
  const draftKey = noteDraftKey(userId, item?.id);
  const suggestions = [...new Set([...noteCategories, ...categorySuggestions])];
  const close = useCallback(() => { if (!inFlight.current) onClose(); }, [onClose]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (typeof draft.title === "string" && typeof draft.description === "string" && typeof draft.category === "string") {
          setForm({ title: draft.title, description: draft.description, category: draft.category });
          setDraftMessage("已恢復這個分頁的未儲存草稿。");
        }
      }
    } catch { setDraftMessage("未能讀取草稿；請保留內容，並按「儲存筆記」。"); }
    setDraftReady(true);
  }, [draftKey]);

  useEffect(() => {
    if (!draftReady || saved.current) return;
    try {
      if (form.title || form.description || form.category) sessionStorage.setItem(draftKey, JSON.stringify(form));
      else sessionStorage.removeItem(draftKey);
    } catch { setDraftMessage("此瀏覽器未能暫存草稿；請勿關閉頁面，並按「儲存筆記」。"); }
  }, [draftKey, draftReady, form]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const validation = validateNoteInput(form);
    if (validation) { setError(validation); return; }
    if (!navigator.onLine) { setError("目前未連線，筆記尚未儲存。請保持此頁開啟，連線後再按「儲存筆記」。"); return; }
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const fields = { title: form.title.trim(), description: form.description.trim() || null };
      const result = item
        ? await controlAction<{ item: OperatingItem }>("update_item", { id: item.id, noteCategory: form.category.trim(), changes: fields })
        : await controlAction<{ item: OperatingItem }>("create_item", { itemType: "note", area: "personal", sensitive: true, noteCategory: form.category.trim(), ...fields });
      saved.current = true;
      try { sessionStorage.removeItem(draftKey); } catch { /* Successful server save must still finish. */ }
      onSaved(result.item);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "筆記尚未儲存，請重新嘗試。");
    } finally { inFlight.current = false; setSaving(false); }
  }

  return <Modal title={item ? "修改筆記" : "新增筆記"} onClose={close}>
    <form className="grid gap-4" onSubmit={save}>
      <p className="text-sm leading-6 text-slate-600">只用來記事。分類是方便自己整理的標籤，不會分享筆記或建立財務紀錄。</p>
      <div><label className="label" htmlFor={titleId}>標題</label><input id={titleId} className="field mt-2" value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} maxLength={500} required autoFocus disabled={saving} /></div>
      <div><label className="label" htmlFor={contentId}>內容</label><textarea id={contentId} className="field mt-2 min-h-56" value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} maxLength={10000} placeholder="記下你想保留的內容…" disabled={saving} /></div>
      <div><label className="label" htmlFor={categoryId}>分類／Remark（可留空）</label><input id={categoryId} className="field mt-2" list={categoryListId} value={form.category} onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))} maxLength={noteCategoryMaxLength} placeholder="選擇分類，或自行輸入" disabled={saving} /><datalist id={categoryListId}>{suggestions.map((category) => <option key={category} value={category} />)}</datalist></div>
      <p className="text-xs leading-5 text-slate-500" role="status">{draftMessage || "輸入會暫存在這個分頁；按「儲存筆記」才正式保存。登出會清除草稿。"}</p>
      {error ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={saving || !draftReady}>{saving ? "儲存中…" : "儲存筆記"}</Button><Button type="button" variant="secondary" onClick={onClose} disabled={saving}>返回</Button></div>
    </form>
  </Modal>;
}
