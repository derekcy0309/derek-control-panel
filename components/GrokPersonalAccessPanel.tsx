"use client";

import { useRef, useState } from "react";
import { Copy, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";

type ArchiveReview = {
  id: string;
  dataset: string;
  recordId: string;
  label: string;
  createdAt: string;
};
type State = { connected: boolean; expiresAt: string | null; pending: ArchiveReview[] };
type Changes =
  | { action: "rotate"; consent: true }
  | { action: "revoke" }
  | { action: "confirm"; requestId: string; ownerOrdered: true; confirmation: "archive" }
  | { action: "dismiss"; requestId: string };
const endpoint = "/api/agent-access/personal";
const category: Record<string, string> = {
  tasks: "任務", notes: "筆記", school: "子女及學校", family: "家庭", finance_transactions: "個人財務"
};
const hkTime = new Intl.DateTimeFormat("zh-HK", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Hong_Kong" });

function formattedTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? hkTime.format(parsed) : "日期未能讀取";
}

export function GrokPersonalAccessPanel() {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [consent, setConsent] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ownerOrdered, setOwnerOrdered] = useState(false);
  const content = useRef<HTMLDetailsElement>(null);

  async function load() {
    setLoading(true);
    setError("");
    setNeedsLogin(false);
    try {
      const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok) {
        setNeedsLogin(result.reauth === true);
        throw new Error(result.error || "暫時未能讀取 Grok 設定。");
      }
      setState(result);
    } catch (caught) {
      setState(null);
      setError(caught instanceof Error ? caught.message : "連線未完成，請重試。");
    } finally {
      setLoading(false);
    }
  }

  async function save(changes: Changes) {
    if (busy || loading) return;
    setBusy(true);
    setError("");
    setNotice("");
    setNeedsLogin(false);
    try {
      const response = await fetch(endpoint, {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes)
      });
      const result = await response.json();
      if (!response.ok) {
        setNeedsLogin(result.reauth === true);
        if (response.status === 404 || response.status === 409) {
          setOwnerOrdered(false);
          setSelectedId(null);
        }
        throw new Error(result.error || "未能核對操作結果，請重新讀取。");
      }
      if (changes.action === "rotate" || changes.action === "revoke") {
        setState({ connected: result.connected, expiresAt: result.expiresAt, pending: [] });
        setConsent(false);
        setRevokeOpen(false);
        setShowCode(false);
        setCode(changes.action === "rotate" && content.current?.open ? result.accessCode : "");
        setNotice(changes.action === "rotate"
          ? "已建立新 Code。上一個本人專用 Code 如有，已停用。"
          : "已停用本人專用 Code；未確認的封存建議已取消。");
      } else {
        setState(previous => previous ? { ...previous, pending: previous.pending.filter(item => item.id !== changes.requestId) } : previous);
        setNotice(changes.action === "confirm" ? "已按你的指示封存；記錄冇永久刪除。" : "已拒絕建議，原有記錄冇改過。");
      }
      setOwnerOrdered(false);
      setSelectedId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能核對操作結果，請重新讀取，唔好當作已成功。");
    } finally {
      setBusy(false);
    }
  }

  async function reauthenticate() {
    if (busy) return;
    setBusy(true);
    setError("");
    setCode("");
    setShowCode(false);
    setOwnerOrdered(false);
    setSelectedId(null);
    try {
      const response = await fetch("/api/auth/google", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ next: "/settings" })
      });
      const result = await response.json();
      if (!response.ok || typeof result.url !== "string") throw new Error(result.error || "未能開始 Google 登入。");
      window.location.assign(result.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "暫時未能登入，請重試。");
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setNotice("已複製。只貼入 Grok 工具嘅安全憑證欄，唔好傳到對話。");
    } catch {
      setError("未能複製。你可以顯示 Access Code，再手動複製。");
    }
  }

  function selectReview(id: string) {
    setOwnerOrdered(false);
    setSelectedId(selectedId === id ? null : id);
  }

  return <section id="grok-personal-access" aria-labelledby="grok-personal-title" className="panel scroll-mt-4 space-y-3 p-5">
    <div className="flex items-start gap-3">
      <ShieldCheck className="mt-1 h-6 w-6 shrink-0" aria-hidden="true" />
      <div>
        <p className="eyebrow">Grok · Private access</p>
        <h2 id="grok-personal-title" className="section-title mt-1">Grok 本人資料存取</h2>
        <p className="muted mt-2 text-sm leading-6">專用 Code，預設關閉。其他人的資料唔會開放，舊有日報及學校 Bot Code 不變。</p>
      </div>
    </div>

    <details ref={content} className="space-y-4" onToggle={(event) => {
      if (event.currentTarget.open) {
        if (!loading && !busy) void load();
      } else {
        setCode("");
        setShowCode(false);
        setSelectedId(null);
        setOwnerOrdered(false);
        setRevokeOpen(false);
        setConsent(false);
      }
    }}>
      <summary className="flex min-h-11 cursor-pointer items-center font-bold text-indigo-700">管理專用 Code 同封存建議</summary>
      {loading ? <p role="status" className="muted text-sm">讀取設定中…</p> : null}
      {state ? <>
        <div className="rounded-xl border border-slate-200 p-4 text-sm leading-6">
          <p className="font-semibold">{state.connected ? "已開啟" : "未開啟"}</p>
          {state.connected && state.expiresAt ? <p className="muted">Code 到期：{formattedTime(state.expiresAt)}（香港時間）</p> : null}
          <p className="muted mt-1">只讀取你本人擁有嘅指定資料，包括個人財務、藥物記錄、家庭及學校事項。iCloud 按月只讀，改行程仍然用 iPhone。</p>
          <p className="muted mt-1">唔包括其他帳戶、公司帳簿、附件、密碼或連接憑證。已分享或其他人一齊處理的記錄不一定開放。</p>
          <a href="/grok-personal-openapi.yaml" className="inline-flex min-h-11 items-center font-bold text-indigo-700">Grok 專用 API 說明</a>
        </div>
        <div className="space-y-3">
          <label className="flex min-h-11 items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm leading-6">
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={consent} disabled={busy || loading} onChange={event => setConsent(event.target.checked)} />
            <span>我同意將以上指定資料開放俾我連接嘅 Grok。{state.connected ? "更換 Code 會停用舊 Code 同取消未確認建議。" : "Grok 唔可以直接刪改資料。"}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || loading || !consent} onClick={() => void save({ action: "rotate", consent: true })}>
              <KeyRound className="h-4 w-4" aria-hidden="true" />{state.connected ? "更換 Access Code" : "開啟並建立 Access Code"}
            </Button>
            {state.connected && !revokeOpen ? <Button type="button" variant="secondary" disabled={busy || loading} onClick={() => setRevokeOpen(true)}>停用</Button> : null}
          </div>
          {revokeOpen ? <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <p className="text-sm">停用後 Grok 不能再用呢個 Code，未確認建議會取消，原有資料不受影響。</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={busy || loading} onClick={() => void save({ action: "revoke" })}>確認停用</Button>
              <Button type="button" variant="ghost" disabled={busy || loading} onClick={() => setRevokeOpen(false)}>返回</Button>
            </div>
          </div> : null}
        </div>
        {code ? <div className="space-y-3 rounded-xl border border-slate-200 p-4 text-sm">
          <p className="font-semibold">Access Code 只顯示今次</p>
          <p className="muted">只用作 Grok 工具嘅 Bearer 憑證。唔好放入聊天、連結或截圖；離開本區後無法取回。</p>
          {showCode ? <code className="block select-all whitespace-normal break-all rounded-lg border border-slate-200 p-3">{code}</code> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void copy()}><Copy className="h-4 w-4" aria-hidden="true" />複製 Code</Button>
            <Button type="button" variant="ghost" aria-expanded={showCode} onClick={() => setShowCode(value => !value)}>{showCode ? "隱藏 Code" : "顯示 Code"}</Button>
          </div>
        </div> : null}
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <h3 className="font-bold">等我確認嘅封存建議</h3>
          <p className="muted text-sm leading-6">Grok 只可以提議封存一項記錄。如果唔係你本人要求，請直接拒絕。喺 Grok 對話答「係」唔會改動 Dayline。</p>
          {state.pending.length === 0 ? <p className="muted text-sm">暫時冇建議。</p> : null}
          {state.pending.map(item => {
            const open = item.id === selectedId;
            return <article key={item.id} className="space-y-2 rounded-xl border border-slate-200 p-3">
              <button type="button" className="min-h-11 w-full text-left font-semibold" aria-expanded={open} aria-controls={`grok-review-${item.id}`} disabled={busy || loading} onClick={() => selectReview(item.id)}>
                <span className="block break-words">{item.label}</span>
                <span className="muted text-sm">{category[item.dataset] || "本人資料"} · {formattedTime(item.createdAt)}</span>
              </button>
              <div id={`grok-review-${item.id}`} hidden={!open} className="space-y-2">
                <p className="muted text-sm leading-6">確認後呢一項會從日常清單移除；不會永久刪除。<span className="block">記錄編號：<code>{item.recordId.slice(0, 8)}</code></span></p>
                <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={open && ownerOrdered} disabled={busy || loading} onChange={event => setOwnerOrdered(event.target.checked)} />係我本人要求封存呢一項</label>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={busy || loading || !ownerOrdered} onClick={() => void save({ action: "confirm", requestId: item.id, ownerOrdered: true, confirmation: "archive" })}>確認封存</Button>
                  <Button type="button" variant="secondary" disabled={busy || loading} onClick={() => void save({ action: "dismiss", requestId: item.id })}>拒絕，保持原狀</Button>
                </div>
              </div>
            </article>;
          })}
        </div>
      </> : null}
      {notice ? <p className="text-sm font-semibold" role="status">{notice}</p> : null}
      {error ? <div className="space-y-2" role="alert">
        <p className="text-sm text-amber-900">{error}</p>
        {needsLogin ? <><p className="muted text-sm">登入後會返到「設定」，再打開「Grok 本人資料存取」確認。</p><Button type="button" variant="secondary" disabled={busy || loading} onClick={() => void reauthenticate()}>用 Google 重新登入</Button></> : null}
      </div> : null}
      <Button type="button" variant="ghost" disabled={busy || loading} onClick={() => void load()}>重新讀取</Button>
    </details>
  </section>;
}
