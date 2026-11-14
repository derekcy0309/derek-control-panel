"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, KeyRound, LogOut, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { agentObject, agentUuidPattern, type AgentItem, type AgentKind, type AgentStatus } from "@/lib/agent-access";

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || "連線未完成，請重試。"), { status: response.status });
  return body;
}
type Draft = { requestId: string; title: string; description: string; dueDate: string; priority: number; tagIds: string[]; category: string };
const draftKey = (id: string, kind: AgentKind) => `dcp:agent-draft:v1:${id}:${kind}`;
function clearDrafts(id: string) { try { sessionStorage.removeItem(draftKey(id, "task")); sessionStorage.removeItem(draftKey(id, "note")); } catch { /* no storage is a supported fallback */ } }

export function AgentWorkspace() {
  const [session, setSession] = useState<AgentStatus | null>(null), [checking, setChecking] = useState(true);
  const [key, setKey] = useState(""), [loginBusy, setLoginBusy] = useState(false);
  const [kind, setKind] = useState<AgentKind>("task"), [items, setItems] = useState<AgentItem[]>([]), [offset, setOffset] = useState(0), [nextOffset, setNextOffset] = useState<number | null>(null);
  const [detail, setDetail] = useState<AgentItem | null>(null), [creating, setCreating] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const sessionRef = useRef<AgentStatus | null>(null);
  const requestVersion = useRef(0);
  const detailVersion = useRef(0);
  const fail = useCallback((caught: unknown) => {
    setError(caught instanceof Error ? caught.message : "連線未完成，請重試。");
    if ((caught as { status?: number })?.status === 401) {
      requestVersion.current++; detailVersion.current++;
      if (sessionRef.current) clearDrafts(sessionRef.current.id);
      sessionRef.current = null; setSession(null); setItems([]); setDetail(null); setCreating(false);
    }
  }, []);
  const check = useCallback(async () => {
    setChecking(true);
    try { const result = await api("/api/agent?view=status"); sessionRef.current = result; setSession(result); setError(""); }
    catch (caught) { if ((caught as { status?: number })?.status !== 401) fail(caught); }
    finally { setChecking(false); }
  }, [fail]);
  useEffect(() => { void check(); }, [check]);
  const loadList = useCallback(async () => {
    if (!session?.id) return;
    const version = ++requestVersion.current; setLoading(true); setError("");
    try { const result = await api(`/api/agent?view=list&kind=${kind}&offset=${offset}`); if (version === requestVersion.current) { setItems(result.items ?? []); setNextOffset(result.nextOffset ?? null); } }
    catch (caught) { if (version === requestVersion.current) fail(caught); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, [session?.id, kind, offset, fail]);
  useEffect(() => { void loadList(); }, [loadList]);
  async function login(event: React.FormEvent) {
    event.preventDefault(); if (loginBusy) return; setLoginBusy(true); setError("");
    try { const result = await api("/api/agent/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key.trim() }) }); setKey(""); sessionRef.current = result; setSession(result); }
    catch (caught) { fail(caught); }
    finally { setLoginBusy(false); }
  }
  async function logout() {
    try { await api("/api/agent/session", { method: "DELETE" }); requestVersion.current++; detailVersion.current++; if (sessionRef.current) clearDrafts(sessionRef.current.id); sessionRef.current = null; setSession(null); setItems([]); setDetail(null); setCreating(false); setKey(""); setError(""); }
    catch (caught) { fail(caught); }
  }
  async function open(item: Pick<AgentItem, "id" | "kind">) {
    const principal = sessionRef.current?.id, version = ++detailVersion.current;
    setCreating(false); setDetail(null); setError("");
    try { const result = await api(`/api/agent?view=detail&kind=${item.kind}&id=${item.id}`); if (principal === sessionRef.current?.id && version === detailVersion.current) setDetail(result.item); }
    catch (caught) { if (principal === sessionRef.current?.id && version === detailVersion.current) fail(caught); }
  }
  if (checking) return <main className="app-frame grid min-h-screen place-items-center bg-mist p-5"><p role="status">核對 Grok 登入中…</p></main>;
  if (!session) return <main className="grid min-h-screen place-items-center bg-mist p-5"><section className="panel w-full max-w-lg p-6" aria-labelledby="agent-login-title"><Bot className="h-9 w-9 text-indigo-600" /><p className="eyebrow mt-4">Derek Panel · Agent</p><h1 id="agent-login-title" className="page-title mt-2">Grok Agent 登入</h1><p className="mt-3 text-sm leading-6 text-slate-600">專用工作區：只讀已開放 Task／Notes，並可新增。不可修改、完成、轉交、封存或刪除；不使用你本人的 Google 帳戶。</p><form className="mt-5 grid gap-4" onSubmit={(event) => void login(event)}><label><span className="label">Access Code</span><input className="field mt-2 font-mono" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(event) => setKey(event.target.value)} placeholder="在安全表格填入 Access Code" required /></label><p className="text-xs leading-5 text-slate-500">請用 Grok Vault／Secure Form 填入，唔好貼入普通聊天。若此瀏覽器已有本人登入，這次操作會切換至受限 Agent 登入；其他裝置不受影響。</p><Button type="submit" disabled={loginBusy || !key.trim()}><KeyRound className="h-5 w-5" />{loginBusy ? "登入中…" : "登入 Agent 工作區"}</Button></form>{error ? <p className="mt-4 text-sm font-semibold text-amber-900" role="alert">{error}</p> : null}<div className="mt-4 flex flex-wrap gap-4"><Link href="/" className="min-h-11 text-sm font-semibold text-indigo-700">返回人用 Google 登入</Link><button type="button" className="min-h-11 text-sm font-semibold text-indigo-700" onClick={() => void check()}>重試連線</button></div></section></main>;
  return <main className="app-frame min-h-screen bg-mist px-4 py-6 sm:px-6"><div className="mx-auto grid max-w-5xl gap-5"><header className="panel flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="eyebrow">Agent workspace</p><h1 className="page-title mt-1">{session.label}</h1><p className="mt-2 flex items-center gap-2 text-sm text-slate-600"><ShieldCheck className="h-4 w-4" />只讀＋新增 · 不可改／刪 · 不含其他用戶資料</p></div><Button type="button" variant="secondary" onClick={() => void logout()}><LogOut className="h-4 w-4" />登出 Agent</Button></header>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2" role="group" aria-label="資料類型">{(["task", "note"] as AgentKind[]).map((value) => <button type="button" key={value} aria-pressed={kind === value} className={`min-h-11 rounded-xl border px-5 font-bold ${kind === value ? "border-indigo-500 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white"}`} onClick={() => { detailVersion.current++; setKind(value); setOffset(0); setDetail(null); setCreating(false); }}>{value === "task" ? "Task" : "Notes"}</button>)}</div><Button type="button" onClick={() => { detailVersion.current++; setCreating(true); setDetail(null); }}><Plus className="h-5 w-5" />新增 {kind === "task" ? "Task" : "Notes"}</Button></div>
    {error ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p> : null}
    {creating ? <AgentCreateForm key={`${session.id}:${kind}`} session={session} kind={kind} onUnauthorized={fail} onCreated={async (item) => { if (session.id !== sessionRef.current?.id) return; setCreating(false); await loadList(); if (session.id === sessionRef.current?.id) await open(item); }} onClose={() => setCreating(false)} /> : null}
    {detail ? <section className="panel grid gap-3 p-5" aria-labelledby="agent-detail-title"><div className="flex items-start justify-between gap-3"><h2 id="agent-detail-title" className="section-title break-words">{detail.title}</h2><button type="button" className="min-h-11 shrink-0 px-3 text-sm font-bold text-indigo-700" onClick={() => setDetail(null)}>收起</button></div>{detail.due_date ? <p className="text-sm">期限：{detail.due_date}</p> : null}{detail.status ? <p className="text-sm">狀態：{detail.status}</p> : null}{detail.category ? <p className="text-sm">分類：{detail.category}</p> : null}{detail.description ? <p className="whitespace-pre-wrap break-words text-sm leading-7">{detail.description}</p> : null}{detail.notes ? <p className="whitespace-pre-wrap break-words border-t border-slate-100 pt-3 text-sm leading-7">{detail.notes}</p> : null}{detail.tags?.length ? <p className="text-xs text-slate-500">Tags：{detail.tags.map((tag) => tag.name).join("、")}</p> : null}<p className="muted text-xs">此內容只供讀取；不提供修改或刪除操作。</p></section> : null}
    <section className="panel p-5" aria-labelledby="agent-list-title"><div className="flex items-center justify-between gap-3"><h2 id="agent-list-title" className="section-title">已開放的 {kind === "task" ? "Task" : "Notes"}</h2><button type="button" className="flex min-h-11 items-center gap-2 text-sm font-semibold text-indigo-700" disabled={loading} onClick={() => void loadList()}><RefreshCw className="h-4 w-4" />重新載入</button></div>{loading ? <p className="mt-4 text-sm" role="status">讀取中…</p> : null}<div className="mt-3 grid gap-2">{items.map((item) => <button type="button" key={item.id} onClick={() => void open(item)} className="min-h-14 rounded-xl border border-slate-200 p-4 text-left"><span className="block break-words font-bold">{item.title}</span>{item.due_date ? <span className="mt-1 block text-xs text-slate-500">期限：{item.due_date}</span> : null}</button>)}{!loading && !items.length ? <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">暫時沒有已開放項目。你仍可新增；其他用戶或未開放項目不會顯示。</p> : null}</div><div className="mt-4 flex gap-3">{offset > 0 ? <Button type="button" variant="secondary" onClick={() => setOffset(Math.max(0, offset - 25))}>上一頁</Button> : null}{nextOffset !== null ? <Button type="button" variant="secondary" onClick={() => setOffset(nextOffset)}>下一頁</Button> : null}</div></section>
    <p className="text-xs leading-5 text-slate-500">存取到期：{new Date(session.expiresAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}。管理員停用後立即停止存取。這不是資料庫管理帳戶。</p>
  </div></main>;
}

function AgentCreateForm({ session, kind, onUnauthorized, onCreated, onClose }: { session: AgentStatus; kind: AgentKind; onUnauthorized: (caught: unknown) => void; onCreated: (item: Pick<AgentItem, "id" | "kind">) => Promise<void>; onClose: () => void }) {
  const [form, setForm] = useState<Draft>(() => {
    const empty = { requestId: crypto.randomUUID(), title: "", description: "", dueDate: "", priority: 3, tagIds: session.tags.length === 1 ? [session.tags[0].id] : [], category: "" };
    try {
      const saved = agentObject(JSON.parse(sessionStorage.getItem(draftKey(session.id, kind)) || "null"));
      if (!saved || typeof saved.title !== "string" || typeof saved.requestId !== "string" || !agentUuidPattern.test(saved.requestId)) return empty;
      return { ...empty, requestId: saved.requestId, title: saved.title.slice(0, 500), description: typeof saved.description === "string" ? saved.description.slice(0, 10000) : "", dueDate: typeof saved.dueDate === "string" ? saved.dueDate : "", priority: typeof saved.priority === "number" && [1, 3, 5].includes(saved.priority) ? saved.priority : 3, category: typeof saved.category === "string" ? saved.category.slice(0, 40) : "", tagIds: Array.isArray(saved.tagIds) ? saved.tagIds.filter((id): id is string => typeof id === "string" && session.tags.some((tag) => tag.id === id)) : empty.tagIds };
    } catch { return empty; }
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { try { sessionStorage.setItem(draftKey(session.id, kind), JSON.stringify(form)); } catch { /* Manual input remains usable without browser storage. */ } }, [form, session.id, kind]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const payload = { kind, requestId: form.requestId, title: form.title, description: form.description, ...(kind === "task" ? { dueDate: form.dueDate, priority: form.priority, tagIds: form.tagIds } : { category: form.category }) };
      const result = await api("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      try { sessionStorage.removeItem(draftKey(session.id, kind)); } catch { /* no storage */ }
      await onCreated(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "新增未完成，請重試。草稿已保留。"); if ((caught as { status?: number })?.status === 401) onUnauthorized(caught); }
    finally { setBusy(false); }
  }
  return <form className="panel grid gap-4 p-5" onSubmit={(event) => void submit(event)} aria-labelledby="agent-create-title"><div className="flex items-center justify-between gap-3"><h2 id="agent-create-title" className="section-title">新增 {kind === "task" ? "Task" : "Notes"}</h2><button type="button" className="min-h-11 px-3 text-sm font-bold text-indigo-700" onClick={onClose}>稍後再填</button></div><label><span className="label">{kind === "task" ? "任務名稱" : "筆記標題"}</span><input className="field mt-2" value={form.title} maxLength={500} required onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label><span className="label">內容（可留空）</span><textarea className="field mt-2 min-h-32" value={form.description} maxLength={10000} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>{kind === "task" ? <><fieldset><legend className="label">Tags（最少一個）</legend><div className="mt-2 flex flex-wrap gap-2">{session.tags.map((tag) => <button type="button" key={tag.id} aria-pressed={form.tagIds.includes(tag.id)} className={`min-h-11 rounded-xl border px-4 text-sm font-bold ${form.tagIds.includes(tag.id) ? "border-indigo-500 bg-indigo-50 text-indigo-800" : "border-slate-200"}`} onClick={() => setForm({ ...form, tagIds: form.tagIds.includes(tag.id) ? form.tagIds.filter((id) => id !== tag.id) : [...form.tagIds, tag.id] })}>{tag.name}</button>)}</div>{!session.tags.length ? <p className="mt-2 text-sm text-amber-900">可用 Tags 已被移除；請管理員重新設定存取。</p> : null}</fieldset><div className="grid gap-3 sm:grid-cols-2"><label><span className="label">完成日期（可留空）</span><input className="field mt-2" type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label><label><span className="label">Priority</span><select className="field mt-2" value={form.priority} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })}><option value={1}>P1 高</option><option value={3}>P2 一般</option><option value={5}>P3 低</option></select></label></div></> : <label><span className="label">分類（可留空）</span><input className="field mt-2" value={form.category} maxLength={40} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>}{error ? <p role="alert" className="text-sm font-semibold text-amber-900">{error}</p> : null}<p className="text-xs leading-5 text-slate-500">只建立新的私人項目，不會改動或指派現有工作。重試會沿用同一識別碼，避免重複。</p><Button type="submit" disabled={busy || !form.title.trim() || (kind === "task" && !form.tagIds.length)}>{busy ? "新增中…" : "確認新增"}</Button></form>;
}
