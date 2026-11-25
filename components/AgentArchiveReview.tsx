"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

type ArchiveRequest = { id: string; label: string; kind: "task" | "note"; createdAt: string; grantLabel: string };
const endpoint = "/api/agent-access/archive-requests";
const dateTime = new Intl.DateTimeFormat("zh-HK", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Hong_Kong" });
function formatTime(value: string) {
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? dateTime.format(instant) : "日期未能讀取";
}

export function AgentArchiveReview() {
  const [requests, setRequests] = useState<ArchiveRequest[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [ordered, setOrdered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);

  function resetChoice() {
    setSelected(null);
    setOrdered(false);
  }

  function begin() {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setNeedsLogin(false);
    return true;
  }

  function finish() {
    inFlight.current = false;
    setBusy(false);
  }

  async function refresh() {
    if (!begin()) return;
    resetChoice();
    setRequests(null);
    try {
      const response = await fetch(endpoint, { credentials: "same-origin", cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(result.requests)) {
        setNeedsLogin(result.reauth === true);
        throw new Error(result.error || "暫時未能讀取封存建議。");
      }
      setRequests(result.requests);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "暫時未能讀取封存建議。");
    } finally {
      finish();
    }
  }

  async function decide(id: string, decision: "confirm" | "dismiss") {
    if (decision === "confirm" && (selected !== id || !ordered)) return;
    if (!begin()) return;
    const body = decision === "confirm"
      ? { id, decision, ownerOrdered: true, confirmation: "archive" }
      : { id, decision };
    try {
      const response = await fetch(endpoint, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status !== (decision === "confirm" ? "archived" : "dismissed")) {
        setNeedsLogin(result.reauth === true);
        if (response.status === 404 || response.status === 409) {
          setRequests(previous => previous?.filter(item => item.id !== id) ?? null);
        }
        throw new Error(result.error || "未能核對結果，請先重新載入封存建議。");
      }
      setRequests(previous => previous?.filter(item => item.id !== id) ?? null);
      setNotice(decision === "confirm" ? "已按你確認封存，原有資料冇永久刪除。" : "已拒絕建議，原有資料冇改動。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能核對結果，請先重新載入封存建議。");
    } finally {
      resetChoice();
      finish();
    }
  }

  async function reauthenticate() {
    if (!begin()) return;
    resetChoice();
    try {
      const response = await fetch("/api/auth/google", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ next: "/settings" })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.url !== "string") throw new Error(result.error || "暫時未能開始重新登入。");
      window.location.assign(result.url);
    } catch (caught) {
      setNeedsLogin(true);
      setError(caught instanceof Error ? caught.message : "暫時未能開始重新登入。");
      finish();
    }
  }

  return <details className="rounded-xl border border-slate-200 p-3" onToggle={event => {
    if (event.currentTarget.open) void refresh();
    else resetChoice();
  }}>
    <summary className="flex min-h-11 cursor-pointer items-center font-bold">封存建議 · 由我確認</summary>
    <p className="muted mb-3 text-sm leading-6">Agent 只可以提出建議。除非係你本人要求，否則唔好確認。封存可復原，唔會永久刪除。</p>
    {busy ? <p role="status" className="text-sm">處理中…</p> : null}
    {error ? <p role="alert" className="my-2 text-sm font-semibold">{error}</p> : null}
    {notice ? <p role="status" className="my-2 text-sm font-semibold">{notice}</p> : null}
    {needsLogin ? <div className="mb-2">
      <p className="muted text-sm">重新登入後，請返設定再核對同確認；唔會自動封存。</p>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void reauthenticate()}>用 Google 重新登入</Button>
    </div> : null}
    {requests?.length === 0 ? <p className="muted text-sm">未有待確認嘅封存建議。</p> : null}
    {requests?.length ? <ul className="my-2 grid gap-2">
      {requests.map(item => <li key={item.id} className="rounded-lg border border-slate-200 p-3">
        <p className="break-words font-semibold">{item.label}</p>
        <p className="muted break-words text-xs">{item.kind === "task" ? "Task" : "筆記"} · {item.grantLabel} · {formatTime(item.createdAt)}</p>
        {selected === item.id ? <div className="my-2 grid gap-2">
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="h-5 w-5 shrink-0" checked={ordered} disabled={busy} onChange={event => setOrdered(event.target.checked)} />
            <span>呢一項係我本人要求封存。</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || !ordered || needsLogin} onClick={() => void decide(item.id, "confirm")}>確認封存</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={resetChoice}>取消確認</Button>
          </div>
        </div> : <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => { setOrdered(false); setSelected(item.id); }}>核對封存建議</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void decide(item.id, "dismiss")}>拒絕建議</Button>
        </div>}
      </li>)}
    </ul> : null}
    <Button type="button" variant="secondary" disabled={busy} onClick={() => void refresh()}>重新載入建議</Button>
  </details>;
}
