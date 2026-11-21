"use client";

import { useState, type FormEvent } from "react";
import {
  DEFAULT_PINNED_PAGES, PINNED_PAGE_GROUPS, isPinnedPageHref, makePinnedSlots, updatePinnedSlot, type PinnedPageHref
} from "@/lib/dayline-pinned-pages";

export function PinnedPageEditor({ pins, onSave, onCancel }: {
  pins: readonly PinnedPageHref[];
  onSave: (pins: PinnedPageHref[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [slots, setSlots] = useState(() => makePinnedSlots(pins));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const selected = slots.filter(isPinnedPageHref);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !selected.length) return;
    setError(false);
    setBusy(true);
    try {
      await onSave(selected);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return <form className="dl-pin-editor" onSubmit={save} aria-label="自訂頂欄捷徑" aria-describedby="dayline-pin-help">
    <p id="dayline-pin-help">由上至下排好常用功能。揀咗已用嘅捷徑會同原位互換。最多 5 個，跟你帳戶同步。</p>
    <div className="dl-pin-slots">
      {slots.map((value, index) => <label key={index} className="dl-pin-slot">
        <span>第 {index + 1} 個</span>
        <select value={value} aria-label={`捷徑 ${index + 1}`} disabled={busy} onChange={event => {
          const page = event.currentTarget.value;
          if (page === "" || isPinnedPageHref(page)) setSlots(current => updatePinnedSlot(current, index, page));
        }}>
          <option value="">不顯示</option>
          {PINNED_PAGE_GROUPS.map(group => <optgroup key={group.label} label={group.label}>
            {group.options.map(option => <option key={option.href} value={option.href}>{option.label}</option>)}
          </optgroup>)}
        </select>
      </label>)}
    </div>
    {!selected.length ? <p className="dl-pin-hint" role="status">揀最少一個先可以儲存。</p> : null}
    {error ? <p className="dl-pin-error" role="alert">未能儲存捷徑，原有設定冇改。請再試。</p> : null}
    <div className="dl-pin-actions">
      <button type="button" onClick={() => setSlots(makePinnedSlots(DEFAULT_PINNED_PAGES))} disabled={busy}>恢復預設</button>
      <button type="button" onClick={onCancel} disabled={busy}>取消</button>
      <button type="submit" className="dl-pin-save" disabled={busy || !selected.length}>{busy ? "儲存中…" : "儲存捷徑"}</button>
    </div>
  </form>;
}
