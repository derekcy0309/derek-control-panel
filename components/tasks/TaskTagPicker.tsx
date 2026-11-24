"use client";

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { controlAction, loadTaskTags } from "@/lib/control-api";
import { taskTagNameError } from "@/lib/simple-mode";
import { taskTagColors } from "@/lib/task-tag-colors";
import type { PersonalTaskTag } from "@/lib/types";

export function TaskTagPicker({ value, onChange, taskId, onLoadedValue, onCatalog, initialCatalog, disabled = false }: {
  value: string[]; onChange: (ids: string[]) => void; taskId?: string;
  onLoadedValue?: (ids: string[]) => void; onCatalog?: (tags: PersonalTaskTag[]) => void;
  initialCatalog?: PersonalTaskTag[]; disabled?: boolean;
}) {
  const [tags, setTags] = useState<PersonalTaskTag[]>(initialCatalog ?? []);
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const shouldFetch = Boolean(taskId || opened || value.length);
  // Name-only capture should never need a tags request. Keep the catalogue
  // snapshot for one form session and only fetch on opening or explicit retry.
  useEffect(() => {
    if (initialCatalog?.length && retry === 0) {
      setTags(initialCatalog);
      onCatalog?.(initialCatalog);
      return;
    }
    if (!shouldFetch) return;
    let active = true;
    setLoading(true);
    void loadTaskTags(taskId).then((result) => {
      if (!active) return;
      if(!Array.isArray(result.tags))throw new Error("未能讀取你嘅 Tags，請重試。");
      setTags(result.tags);
      onCatalog?.(result.tags);
      if (taskId && Array.isArray(result.taskTagIds)) onLoadedValue?.(result.taskTagIds);
      setError("");
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "Tags 未載入，請重試。");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Keep callback identity and the parent catalogue outside the fetch triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, retry, shouldFetch]);

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
      onCatalog?.(next);
      if (operation === "create") { setName(""); onChange([...value, result.tag.id].slice(0, 20)); }
      if (operation === "delete") {
        if (value.includes(tagId ?? "")) onChange(value.filter((id) => id !== tagId));
        setDeleting(null);
      }
      setEditing(null);
      window.dispatchEvent(new CustomEvent("dcp:task-tags-updated", { detail: { tags: next } }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "未能更新 Tag；原本設定仍然保留。請再試。"); }
    finally { setBusy(false); }
  }

  const colors = useMemo(() => taskTagColors(tags), [tags]);
  const selected = value.filter((id) => colors.has(id));
  const selectedSet = new Set(selected);
  const selectedTags = tags.filter(tag => selectedSet.has(tag.id));
  return <details className="min-w-0 rounded-xl border border-slate-200 px-3" onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary className="min-h-11 cursor-pointer py-2.5 font-semibold text-slate-700">
      <span className="text-indigo-700">＋Tag（可選）</span>
      <span className="ml-2 inline-flex max-w-full flex-wrap items-center gap-1 align-middle text-sm font-normal text-slate-600">
        {selectedTags.length ? selectedTags.slice(0, 3).map(tag => <span key={tag.id} data-tag-id={tag.id} className="task-tag-color max-w-full break-words rounded-full px-2 py-0.5 text-xs font-semibold" style={colors.get(tag.id)}>{tag.name}</span>) : "無 Tag"}
        {selectedTags.length > 3 ? <span>＋{selectedTags.length - 3}</span> : null}
      </span>
    </summary>
    <fieldset className="min-w-0 pb-3" disabled={disabled || busy}>
    <legend className="sr-only">Tags 分類</legend>
    {tags.length ? <p className="mt-2 text-xs text-slate-600">可以同時揀多個 Tag，撳多一次取消。</p> : null}
    {loading ? <p className="mt-2 text-sm text-slate-500" role="status">載入 Tags…</p> : <div className="mt-2 flex flex-wrap gap-2" aria-label="揀選 Tags">
      {tags.map((tag) => {
        const pressed = selectedSet.has(tag.id);
        return <button key={tag.id} data-tag-id={tag.id} type="button" aria-pressed={pressed}
          className="task-tag-color inline-flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-bold"
          style={colors.get(tag.id)}
          onClick={() => onChange(pressed ? selected.filter((id) => id !== tag.id) : [...selected, tag.id].slice(0, 20))}>
          {pressed ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}<span className="min-w-0 break-words">{tag.name}</span>
        </button>;
      })}
      {!tags.length && !error ? <p className="text-sm text-slate-600">未有 Tags；下面可以加一個。已刪除的 Tags 唔會自動加返。</p> : null}
      {selected.length ? <button type="button" className="min-h-11 px-2 text-sm font-semibold text-slate-600 underline" onClick={() => onChange([])}>清除全部 Tags</button> : null}
    </div>}
    <details className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold text-slate-600">管理我的 Tags</summary>
      <p className="my-2 text-xs leading-5 text-slate-500">全部都可以改名或移除，只影響你自己的分類。移除 Tag 唔會刪 Task，亦唔會改分享權限。</p>
      <div className="flex gap-2"><input aria-label="新 Tag 名稱" className="field min-w-0 flex-1 bg-white" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void manage("create"); } }} placeholder="例如：學習" />
        <button type="button" className="min-h-11 shrink-0 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-40" disabled={loading || !name.trim()} onClick={() => void manage("create")}>加 Tag</button></div>
      <div className="mt-3 grid gap-2">{tags.map((tag) => <div key={tag.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2">
        {editing === tag.id ? <><input className="field min-w-0 flex-1" aria-label={`修改 ${tag.name}`} maxLength={40} value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void manage("rename", tag.id); } }} />
          <button type="button" className="min-h-11 px-3 font-bold text-indigo-700" onClick={() => void manage("rename", tag.id)}>儲存</button><button type="button" className="min-h-11 px-2 text-sm" onClick={() => setEditing(null)}>取消</button></>
          : <><span className="min-w-0 flex-1"><span data-tag-id={tag.id} className="task-tag-color inline-block max-w-full break-words rounded-full px-2.5 py-1 text-sm font-bold" style={colors.get(tag.id)}>{tag.name}</span></span>
            <button type="button" className="min-h-11 px-3 text-sm font-semibold text-indigo-700" onClick={() => { setEditing(tag.id); setEditName(tag.name); setDeleting(null); }}>改名</button>
            <button type="button" className="min-h-11 px-3 text-sm font-semibold text-slate-600" onClick={() => deleting === tag.id ? void manage("delete", tag.id) : setDeleting(tag.id)}>{deleting === tag.id ? "確認移除" : "移除"}</button>
            {deleting === tag.id ? <button type="button" className="min-h-11 px-2 text-sm" onClick={() => setDeleting(null)}>取消</button> : null}</>}
      </div>)}</div>
    </details>
    {error ? <div role="alert" className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}{!tags.length ? <button type="button" className="ml-3 min-h-11 underline" onClick={() => setRetry((n) => n + 1)}>重試載入</button> : null}</div> : null}
    </fieldset>
  </details>;
}
