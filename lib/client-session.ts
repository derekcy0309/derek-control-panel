"use client";

// Only a short-lived check result in this browser tab, never data, cookies or
// tokens. Authorized APIs still validate the actual session independently.
const sessionFreshMs = 30_000;
let verifiedAt: number | null = null;
let verifiedUserId: string | null = null;
let pending: Promise<boolean> | null = null;
let pendingAbort: AbortController | null = null;
let generation = 0;
let signingOut = false;

export function clearClientSessionCheck() {
  generation++;
  verifiedAt = null;
  verifiedUserId = null;
  pendingAbort?.abort();
  pendingAbort = null;
  pending = null;
}

export function markClientSessionChecked(userId: string | null) {
  verifiedAt = Date.now();
  verifiedUserId = userId;
}

export function clientSessionIdentity() { return verifiedUserId; }

export function prepareClientSignOut() {
  signingOut = true;
  clearClientSessionCheck();
}

export function resumeClientSessionChecks() { signingOut = false; }

export function checkClientSession(maxAgeMs = sessionFreshMs): Promise<boolean> {
  if (signingOut) return Promise.resolve(false);
  if (verifiedAt !== null && Date.now() - verifiedAt < maxAgeMs) return Promise.resolve(true);
  if (pending) return pending;
  const check = generation;
  const controller = new AbortController();
  pendingAbort = controller;
  pending = fetch("/api/auth", { method: "GET", cache: "no-store", credentials: "same-origin", signal: controller.signal })
    .then(async (response) => {
      if (response.status >= 500) throw new Error("登入狀態暫時未能核對，請稍後再試。");
      const body = response.ok ? await response.json().catch(() => null) as { user?: { id?: unknown } } | null : null;
      if (check !== generation) return false;
      if (response.ok) markClientSessionChecked(typeof body?.user?.id === "string" ? body.user.id : null);
      else { verifiedAt = null; verifiedUserId = null; }
      return response.ok;
    })
    .finally(() => { if (check === generation) { pending = null; pendingAbort = null; } });
  return pending;
}
