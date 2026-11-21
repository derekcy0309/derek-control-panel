"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isUnreadCount } from "@/lib/publications";

type Hint = { kind: "loading" | "failed" | "offline" | "retrying" } | { kind: "ready"; count: number };

// Only mounted after this account's publication preference is known to be on.
// Counts live in memory for this mount: never persist private state in the PWA.
export function PublicationUnreadHint() {
  const [hint, setHint] = useState<Hint>({ kind: "loading" });
  const retry = useRef<(() => void) | null>(null);
  useEffect(() => {
    let active: AbortController | undefined;
    let timer: number | undefined;
    function cancel() {
      active?.abort();
      active = undefined;
      window.clearTimeout(timer);
    }
    function offline() {
      cancel();
      setHint({ kind: "offline" });
    }
    async function refresh() {
      if (!navigator.onLine) { offline(); return; }
      if (active) return;
      const request = new AbortController();
      active = request;
      timer = window.setTimeout(() => { cancel(); setHint({ kind: "failed" }); }, 15000);
      setHint(previous => previous.kind === "offline" || previous.kind === "failed" ? { kind: "retrying" } : previous);
      try {
        const response = await fetch("/api/publications?view=count", { cache: "no-store", signal: request.signal });
        if (!response.ok) throw Error();
        const value = (await response.json())?.unread;
        if (!isUnreadCount(value)) throw Error();
        if (!request.signal.aborted) setHint({ kind: "ready", count: value });
      } catch {
        if (!request.signal.aborted) setHint({ kind: navigator.onLine ? "failed" : "offline" });
      } finally {
        if (active === request) { window.clearTimeout(timer); active = undefined; }
      }
    }
    retry.current = refresh;
    void refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", offline);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      cancel();
      retry.current = null;
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", offline);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, []);

  if (hint.kind === "loading") return null;
  if (hint.kind === "ready") return hint.count > 0
    ? <Link className="dl-pub-line" href="/briefing/publications?mode=unread" prefetch={false}>刊物 · {hint.count} 期未讀</Link>
    : null;
  if (hint.kind === "offline") return <span className="dl-pub-line dl-pub-status" role="status">刊物 · 連線後會再更新</span>;
  return <button type="button" className="dl-pub-line dl-pub-status" disabled={hint.kind === "retrying"} onClick={() => retry.current?.()}>
    {hint.kind === "retrying" ? "刊物更新中…" : "刊物未能更新 · 重試"}
  </button>;
}
