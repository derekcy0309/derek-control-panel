"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Command, Search, ShieldCheck } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { searchControlData } from "@/lib/control-api";

export default function SearchPage() { return <AuthGate><SearchContent /></AuthGate>; }

function SearchContent() {
  const [query, setQuery] = useState(""); const [results, setResults] = useState<Array<Record<string, unknown>>>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { function shortcut(event: KeyboardEvent) { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); inputRef.current?.focus(); } } window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut); }, []);
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    let current = true;
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchControlData(trimmed);
        if (current) setResults(response.results);
      } catch (caught) {
        if (current) setError(caught instanceof Error ? caught.message : "搜尋未完成，請再試一次。");
      } finally {
        if (current) setLoading(false);
      }
    }, 250);
    return () => { current = false; window.clearTimeout(timer); };
  }, [query]);
  function changeQuery(value: string) {
    setQuery(value); setResults([]); setError(""); setLoading(value.trim().length >= 2);
  }
  return <div className="mx-auto max-w-4xl space-y-5">
    <section><p className="eyebrow">Search</p><h1 className="page-title mt-1">全域搜尋</h1><p className="muted mt-2 text-sm leading-6">可以用任務名稱或你自己嘅 Tag 搵，例如「P1」或「Wecare」。只會顯示你有權睇嘅資料。</p></section>
    <section className="panel overflow-hidden">
      <label className="relative block border-b border-slate-200">
        <Search className="pointer-events-none absolute left-4 top-5 h-5 w-5 text-slate-400" aria-hidden="true" />
        <input ref={inputRef} type="search" aria-label="搜尋任務、Tag 或其他資料" className="h-16 w-full bg-transparent pl-12 pr-12 text-lg font-semibold outline-none sm:pr-24" value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="搵任務、Tag、學校、文件…" autoFocus />
        <span className="pointer-events-none absolute right-4 top-4 hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-bold text-slate-500 sm:flex" aria-hidden="true"><Command className="h-3.5 w-3.5" />K</span>
      </label>
      <div className="min-h-64 p-3" aria-live="polite" aria-busy={loading}>
        {loading ? <p role="status" className="muted p-4 text-sm">搜尋中…</p>
          : error ? <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-950">{error}</p>
          : query.trim().length < 2 ? <Empty icon={<Search className="h-5 w-5" />} title="輸入至少兩個字" text="輸入名稱或者 Tag，就會搵到相關任務。" />
          : results.length ? <div className="space-y-2">{results.map((result) => <SearchResult key={`${result.resourceType}-${result.id}`} result={result} />)}</div>
          : <Empty icon={<ShieldCheck className="h-5 w-5" />} title="搵唔到符合嘅資料" text="試另一個 Tag，或者輸入任務名稱其中幾個字。" />}
      </div>
    </section>
  </div>;
}
function SearchResult({ result }: { result: Record<string, unknown> }) {
  const isTask = result.resourceType === "task";
  const tags = Array.isArray(result.matchedTags) ? result.matchedTags.filter((tag): tag is string => typeof tag === "string") : [];
  return <article className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Search className="h-4 w-4" aria-hidden="true" /></div>
    <div className="min-w-0 flex-1">
      {isTask ? <Link className="inline-flex min-h-11 items-center break-words font-semibold underline decoration-slate-400 underline-offset-4" href={`/tasks/${encodeURIComponent(String(result.id))}`}>{String(result.title)}</Link> : <p className="break-words font-semibold">{String(result.title)}</p>}
      <p className="muted mt-1 text-xs">{typeLabel[String(result.itemType)] || String(result.itemType)}{isTask ? "" : ` · ${areaLabel[String(result.area)] || String(result.area)}`} · {statusLabel[String(result.status)] || String(result.status)}</p>
      {tags.length ? <p className="muted mt-1 break-words text-xs">Tag：{tags.join("、")}</p> : null}
    </div>
    {result.visibility && result.visibility !== "private" ? <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">已授權分享</span> : null}
  </article>;
}
function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="grid min-h-56 place-items-center text-center"><div><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-500">{icon}</div><h2 className="mt-3 font-bold">{title}</h2><p className="muted mt-1 max-w-sm text-sm leading-6">{text}</p></div></div>; }
const typeLabel: Record<string, string> = { task: "任務", project: "項目", waiting: "等待事項", decision: "決策", client: "舊有已停用資料", sop: "SOP", school: "學校", pet: "寵物", household: "家居", shopping: "購物", health: "健康行政", document: "文件", vehicle: "車輛", note: "私人筆記", event: "日程" };
const areaLabel: Record<string, string> = { work: "工作", family: "家庭", personal: "個人" };
const statusLabel: Record<string, string> = { not_started: "未開始", in_progress: "進行中", waiting: "等待中", blocked: "受阻", done: "已完成", active: "進行中", review: "待檢視", completed: "已完成", cancelled: "已取消", inbox: "收集箱" };
