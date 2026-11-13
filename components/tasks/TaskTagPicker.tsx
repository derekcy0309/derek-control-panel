"use client";

import { useEffect, useState } from "react";
import { controlAction, loadTaskTags } from "@/lib/control-api";
import { taskTagNameError } from "@/lib/simple-mode";
import type { PersonalTaskTag } from "@/lib/types";

export function TaskTagPicker({ value, onChange, taskId, onReady, disabled = false }: {
  value: string[]; onChange: (ids: string[]) => void; taskId?: string;
  onReady: (ready: boolean) => void; disabled?: boolean;
}) {
  const [tags, setTags] = useState<PersonalTaskTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  // Stable parent callbacks are intentionally not required to keep typing from re-fetching.
  useEffect(() => {
    let active = true;
    setLoading(true);
    onReady(false);
    void loadTaskTags(taskId).then((result) => {
      if (!active) return;
      setTags(result.tags);
      if (taskId) onChange(result.taskTagIds);
      setError("");
      onReady(true);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "Tags 未載入，請重試。");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Only load when opening another task or explicitly retrying, never on form input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, retry]);

  async function manage(operation: "create" | "rename" | "delete", tagId?: string) {
    if (busy || disabled) return;
    const nextName = operation === "create" ? name : editName;
    if (operation !== "delete") {
      const invalid = taskTagNameError(nextName);
      if (invalid) { setError(invalid); return; }
    }
    setBusy(true); setError("");
    try {
      const result = await controlAction<{ tag: PersonalTaskTag }>("manage_task_tag", { operation, tagId, name: nextName.trim() });
      const next = operation === "create" ? [...tags, result.tag] : operation === "delete"
        ? tags.filter((tag) => tag.id !== tagId) : tags.map((tag) => tag.id === tagId ? result.tag : tag);
      setTags(next);
      if (operation === "create") { setName(""); onChange([...value, result.tag.id].slice(0, 20)); }
      if (operation === "delete") { onChange(value.filter((id) => id !== tagId)); setDeleting(null); }
      setEditing(null);
      window.dispatchEvent(new CustomEvent("dcp:task-tags-updated", { detail: { tags: next } }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "未能更新 Tag；原本設定仍然保留。請再試。"); }
    finally { setBusy(false); }
  }

  const selected = value.filter((id) => tags.some((tag) => tag.id === id));
  return <fieldset className="min-w-0" aria-required="true" disabled={disabled || busy}>
    <legend className="label">Tags 分類（必填）</legend>
    {loading ? <p className="mt-2 text-sm text-slate-500" role="status">載入 Tags…</p> : <div className="mt-2 flex flex-wrap gap-2" aria-label="揀選 Tags">
      {tags.map((tag) => <button key={tag.id} type="button" aria-pressed={selected.includes(tag.id)}
        className={`min-h-11 break-words rounded-xl border px-4 py-2 text-sm font-bold ${selected.includes(tag.id) ? "border-indigo-500 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-500" : "border-slate-200 bg-white text-slate-600"}`}
        onClick={() => onChange(selected.includes(tag.id) ? selected.filter((id) => id !== tag.id) : [...selected, tag.id].slice(0, 20))}>{tag.name}</button>)}
      {!tags.length ? <p className="text-sm text-slate-600">未有 Tags；下面可以加一個。已刪除的 Tags 唔會自動加返。</p> : null}
    </div>}
    <details className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold text-slate-600">管理我的 Tags</summary>
      <p className="my-2 text-xs leading-5 text-slate-500">全部都可以改名或移除，只影響你自己的分類。移除 Tag 唔會刪 Task，亦唔會改分享權限。</p>
      <div className="flex gap-2"><input aria-label="新 Tag 名稱" className="field min-w-0 flex-1 bg-white" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void manage("create"); } }} placeholder="例如：學習" />
        <button type="button" className="min-h-11 shrink-0 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-40" disabled={loading || !name.trim()} onClick={() => void manage("create")}>加 Tag</button></div>
      <div className="mt-3 grid gap-2">{tags.map((tag) => <div key={tag.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2">
        {editing === tag.id ? <><input className="field min-w-0 flex-1" aria-label={`修改 ${tag.name}`} maxLength={40} value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void manage("rename", tag.id); } }} />
          <button type="button" className="min-h-11 px-3 font-bold text-indigo-700" onClick={() => void manage("rename", tag.id)}>儲存</button><button type="button" className="min-h-11 px-2 text-sm" onClick={() => setEditing(null)}>取消</button></>
          : <><span className="min-w-0 flex-1 break-words text-sm font-bold">{tag.name}</span>
            <button type="button" className="min-h-11 px-3 text-sm font-semibold text-indigo-700" onClick={() => { setEditing(tag.id); setEditName(tag.name); setDeleting(null); }}>改名</button>
            <button type="button" className="min-h-11 px-3 text-sm font-semibold text-slate-600" onClick={() => deleting === tag.id ? void manage("delete", tag.id) : setDeleting(tag.id)}>{deleting === tag.id ? "確認移除" : "移除"}</button>
            {deleting === tag.id ? <button type="button" className="min-h-11 px-2 text-sm" onClick={() => setDeleting(null)}>取消</button> : null}</>}
      </div>)}</div>
    </details>
    {error ? <div role="alert" className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}{!tags.length ? <button type="button" className="ml-3 min-h-11 underline" onClick={() => setRetry((n) => n + 1)}>重試載入</button> : null}</div> : null}
  </fieldset>;
}
