"use client";

import type { ControlData } from "@/lib/types";

let refreshInFlight: Promise<void> | null = null;
let lastRefreshAt = 0;

export async function loadControlData(): Promise<ControlData> {
  return controlRequest<ControlData>("/api/control?view=bootstrap", { method: "GET" });
}

export async function searchControlData(query: string) {
  return controlRequest<{ results: Array<Record<string, unknown>> }>(`/api/control?view=search&q=${encodeURIComponent(query)}`, { method: "GET" });
}

export async function controlAction<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}) {
  return controlRequest<T>("/api/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload })
  });
}

async function controlRequest<T>(url: string, init: RequestInit): Promise<T> {
  await ensureFreshSession();
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: { ...init.headers }
  });
  const result = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(result.error || "操作失敗，請稍後再試。");
  return result;
}

async function ensureFreshSession() {
  if (Date.now() - lastRefreshAt < 30_000) return;
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin"
    }).then((response) => {
      if (!response.ok) throw new Error("登入已失效，請重新登入。");
      lastRefreshAt = Date.now();
    }).finally(() => {
      refreshInFlight = null;
    });
  }
  await refreshInFlight;
}
