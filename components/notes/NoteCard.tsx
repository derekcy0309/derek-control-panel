"use client";

import { noteCategory } from "@/lib/notes";
import type { OperatingItem } from "@/lib/types";

export function NoteCard({ item, onOpen }: { item: OperatingItem; onOpen?: () => void }) {
  const content = <>
    <span className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-800">{noteCategory(item) || "未分類"}</span>
    <h2 className="mt-3 break-words text-lg font-bold text-slate-950">{item.title}</h2>
    {item.description ? <p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{item.description}</p> : <p className="mt-2 text-sm text-slate-500">未填內容</p>}
    {onOpen ? <span className="mt-4 block text-sm font-bold text-indigo-700">打開筆記</span> : null}
  </>;
  return <article className="panel overflow-hidden">{onOpen
    ? <button type="button" className="min-h-32 w-full p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 sm:p-5" onClick={onOpen} aria-label={`打開筆記：${item.title}`}>{content}</button>
    : <div className="p-4 sm:p-5">{content}</div>}</article>;
}
