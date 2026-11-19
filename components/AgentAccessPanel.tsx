"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Bot, Copy, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { AgentEvent, AgentGrant, AgentTag } from "@/lib/agent-access";

type Option = { id: string; title: string };
type Data = { grants: AgentGrant[]; events: AgentEvent[]; tasks: Option[]; notes: Option[]; tags: AgentTag[] };
const actions: Record<string, string> = { grant_created: "建立存取", grant_revoked: "停用存取", status: "登入／核對存取", list: "讀取清單", detail: "讀取內容", create_task: "新增 Task", create_note: "新增 Notes" };
function time(value: string | null) { return value ? new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" }) : "未使用"; }

export function AgentAccessPanel() {
  const [data, setData] = useState<Data | null>(null), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [label, setLabel] = useState("Grok Bot"), [days, setDays] = useState(30);
  const [taskIds, setTaskIds] = useState<string[]>([]), [noteIds, setNoteIds] = useState<string[]>([]), [tagIds, setTagIds] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false), [code, setCode] = useState(""), [showCode, setShowCode] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/agent-access", { cache: "no-store", credentials: "same-origin" });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || "未能讀取 Agent 設定。");
      setData(value as Data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "連線未完成，請重試。"); }
    finally { setLoading(false); }
  }, []);
  async function create() {
    if (busy) return; setBusy(true); setError(""); setMessage(""); setCode("");
    try {
      const response = await fetch("/api/agent-access", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", label, days, taskIds, noteIds, tagIds, acknowledged }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "未能建立 Agent 存取。");
      setCode(result.accessCode); setShowCode(false); setAcknowledged(false);
      setMessage("Bot Login 已建立。Access Code 只顯示今次，請存入 該 bot 的安全憑證欄，唔好貼入普通聊天。");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "未能建立 Agent 存取。"); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    if (busy) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/agent-access", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revoke", id }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "未能停用。");
      setRevokeId(null); setCode(""); setMessage("已停用；該 Access Code 及 Agent session 不能再讀取或新增資料。"); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "未能停用，請重試。"); }
    finally { setBusy(false); }
  }
  function toggle(id: string, selected: string[], set: (ids: string[]) => void) { set(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]); }
  async function copy() {
    try { await navigator.clipboard.writeText(`Login: ${location.origin}/agent\nAccess Code: ${code}`); setMessage("Login 資料已複製。請只貼入 該 bot 的安全憑證欄。"); }
    catch { setError("未能使用剪貼簿；可按顯示後自行複製 Access Code。"); }
  }
  return <section className="panel p-5" aria-labelledby="agent-access-title" onKeyDown={(event) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
    <div className="flex items-start gap-3"><Bot className="mt-1 h-6 w-6 shrink-0 text-indigo-600" /><div><p className="eyebrow">AI Agent access</p><h2 id="agent-access-title" className="section-title mt-1">AI Bot 登入</h2><p className="muted mt-2 text-sm leading-6">呢度管理獨立 Access Code。一般 Code 只可讀已揀嘅本人 Task／Notes 同新增；學校授權分開管理。</p></div></div>
    <Link className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-indigo-700" href="/workspace/school#bot-review">只想開放子女及學校？去管理學校 bot</Link>
    <details className="mt-4" onToggle={(event) => { if (event.currentTarget.open && !data && !loading) void load(); if (!event.currentTarget.open) { setCode(""); setShowCode(false); } }}>
      <summary className="flex min-h-11 cursor-pointer items-center font-bold text-indigo-700">管理 Bot Login／Access Code</summary>
      {loading && !data ? <p role="status" className="mt-4 text-sm">讀取設定中…</p> : null}
      {data ? <div className="mt-4 grid gap-5">
        <div className="rounded-xl bg-indigo-50 p-3 text-sm leading-6 text-indigo-900"><ShieldCheck className="mr-2 inline h-4 w-4" />人用 Google；每個 bot 用自己嘅 Access Code。財務／藥物專頁、附件及私人資源不開放。選定 Notes 仍可能包含私人內容，請先檢查。</div>
        <div className="grid gap-3 sm:grid-cols-2"><label><span className="label">連接名稱</span><input className="field mt-2" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={50} /></label><label><span className="label">有效期</span><select className="field mt-2" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={1}>1 日</option><option value={7}>7 日</option><option value={30}>30 日</option><option value={90}>90 日</option></select></label></div>
        <fieldset><legend className="label">Bot 新增 Task 時可用的 Tags（最少一個）</legend><div className="mt-2 flex flex-wrap gap-2">{data.tags.map((tag) => <button type="button" key={tag.id} aria-pressed={tagIds.includes(tag.id)} className={`min-h-11 rounded-xl border px-4 text-sm font-semibold ${tagIds.includes(tag.id) ? "border-indigo-500 bg-indigo-50 text-indigo-800" : "border-slate-200"}`} onClick={() => toggle(tag.id, tagIds, setTagIds)}>{tag.name}</button>)}</div>{!data.tags.length ? <p className="mt-2 text-sm">請先在加 Task 內建立 Tag，再重新載入。</p> : null}</fieldset>
        <details className="rounded-xl border border-slate-200 p-3"><summary className="min-h-11 cursor-pointer font-bold">揀可讀取的本人資料（Task {taskIds.length}／Notes {noteIds.length}）</summary><p className="muted my-2 text-xs leading-5">只列出你擁有的最近 100 項；別人分享俾你但唔係你擁有的項目不在此列。留空亦可新增；該 bot 自己新增的項目會自動可讀。</p>
          <div className="grid gap-4 md:grid-cols-2">{([{ kind: "Task", options: data.tasks, selected: taskIds, set: setTaskIds }, { kind: "Notes", options: data.notes, selected: noteIds, set: setNoteIds }]).map((group) => <fieldset key={group.kind}><legend className="font-bold">{group.kind}</legend><button type="button" className="my-2 min-h-11 text-sm font-semibold text-indigo-700" onClick={() => group.set(group.selected.length === group.options.length ? [] : group.options.map((item) => item.id))}>{group.selected.length === group.options.length && group.options.length ? "取消全選" : "選取目前顯示項目"}</button><div className="max-h-64 space-y-1 overflow-auto">{group.options.map((item) => <label key={item.id} className="flex min-h-11 items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={group.selected.includes(item.id)} onChange={() => toggle(item.id, group.selected, group.set)} /><span className="break-words">{item.title}</span></label>)}{!group.options.length ? <p className="muted text-sm">暫時沒有本人項目。</p> : null}</div></fieldset>)}</div></details>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>我同意呢個 bot 讀取上述選定內容，並以我的名義新增私人 Task／Notes；其他資料及用戶不開放。</span></label>
        <div><Button type="button" disabled={busy || !acknowledged || !tagIds.length} onClick={() => void create()}><KeyRound className="h-4 w-4" />{busy ? "處理中…" : "建立一般 Bot Login"}</Button></div>
        {code ? <div className="grid gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4"><p className="font-bold">Access Code 只顯示一次</p><p className="break-all text-sm">登入網址：<a className="underline" href="/agent" target="_blank" rel="noreferrer">/agent</a></p><label><span className="label">Bot Access Code</span><input className="field mt-2 font-mono" type={showCode ? "text" : "password"} value={code} readOnly autoComplete="off" /></label><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => void copy()}><Copy className="h-4 w-4" />複製 Login 資料</Button><Button type="button" variant="secondary" onClick={() => setShowCode(!showCode)}>{showCode ? "隱藏" : "顯示 Access Code"}</Button></div><p className="text-xs leading-5">關閉本區或重新載入後無法取回 Code；遺失時停用舊連接，再建立新的。不要在 普通聊天或本頁網址放 Code。</p></div> : null}
        <div><h3 className="font-bold">現有 Agent 存取</h3><div className="mt-2 grid gap-2">{data.grants.map((grant) => { const disabled = Boolean(grant.revoked_at) || Date.parse(grant.expires_at) <= Date.now(); return <div key={grant.id} className="rounded-xl border border-slate-200 p-3 text-sm"><p className="font-bold">{grant.label} · {disabled ? "已停用／到期" : "可用"}</p><p className="muted mt-1 text-xs">到期：{time(grant.expires_at)} · 最後使用：{time(grant.last_used_at)}</p><p className="muted mt-1 font-mono text-xs">識別：{grant.key_fingerprint}</p>{!disabled ? <Button type="button" variant="secondary" className="mt-2" disabled={busy} onClick={() => revokeId === grant.id ? void revoke(grant.id) : setRevokeId(grant.id)}>{revokeId === grant.id ? "確認停用這個 Access Code" : "停用存取"}</Button> : null}</div>; })}{!data.grants.length ? <p className="muted text-sm">未有 Agent 存取；不會自動替你建立。</p> : null}</div></div>
        <details><summary className="min-h-11 cursor-pointer font-bold">最近操作紀錄</summary><ul className="space-y-2 text-xs text-slate-600">{data.events.map((event) => <li key={event.id}>{actions[event.action] ?? "Agent 操作"} · {time(event.created_at)}{event.resource_id ? ` · ${event.resource_id.slice(0, 8)}` : ""}</li>)}</ul></details>
      </div> : null}
      {error ? <p className="mt-3 text-sm font-semibold text-amber-900" role="alert">{error}</p> : null}
      {message ? <p className="mt-3 text-sm font-semibold text-slate-700" role="status">{message}</p> : null}
      <button type="button" disabled={loading} className="mt-3 flex min-h-11 items-center gap-2 text-sm font-semibold text-indigo-700" onClick={() => void load()}><RefreshCw className="h-4 w-4" />重新載入 Agent 設定</button>
    </details>
  </section>;
}
