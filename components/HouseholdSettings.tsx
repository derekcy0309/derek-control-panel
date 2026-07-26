"use client";

import { useState } from "react";
import { Check, HeartHandshake, Mail, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { HouseholdContext } from "@/lib/types";

export function HouseholdSettings({
  household,
  onChanged
}: {
  household: HouseholdContext | null;
  onChanged: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function send(action: "invite" | "respond", extra: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/household", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "未能更新家庭連結。");
      setEmail("");
      setMessage(action === "invite" ? "家庭邀請已建立；對方接受後先會睇到家庭項目。" : "家庭邀請已處理。");
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "未能更新家庭連結。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow flex items-center gap-2"><HeartHandshake className="h-4 w-4" />Household Privacy</p>
          <h2 className="section-title mt-1">家庭共享，私人同工作仍然分開</h2>
          <p className="muted mt-2 max-w-2xl text-sm leading-6">
            只有標示為「家庭」嘅項目會喺邀請接受後共享。個人同工作任務唔會因連結家庭而曝光。
          </p>
        </div>
        <span className="flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
          <ShieldCheck className="h-4 w-4" />Database RLS 保護
        </span>
      </div>

      {household?.status === "invited" ? (
        <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
          <p className="font-extrabold text-slate-900">你收到家庭共享邀請</p>
          <p className="mt-1 text-sm text-slate-600">接受後，雙方現有及新家庭項目會共享；私人同工作項目保持私人。</p>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="success" disabled={busy} onClick={() => void send("respond", { householdId: household.householdId, accept: true })}><Check className="h-4 w-4" />接受</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void send("respond", { householdId: household.householdId, accept: false })}><X className="h-4 w-4" />拒絕</Button>
          </div>
        </div>
      ) : null}

      {household?.status === "accepted" ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {household.members.map((member) => (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3" key={member.userId}>
              <p className="font-bold text-slate-900">{member.displayName}</p>
              <p className="mt-1 text-xs text-slate-500">
                {member.status === "accepted" ? "已連結" : member.status === "declined" ? "已拒絕" : "等待接受"}
                {" · "}
                {member.role === "owner" ? "建立者" : "成員"}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {!household || household.status === "accepted" && !household.members.some(
        (member) => member.role === "member" && (member.status === "invited" || member.status === "accepted")
      ) ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1">
            <span className="label">另一位用戶嘅登入電郵</span>
            <div className="relative mt-2">
              <Mail className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
              <input className="field pl-10" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Suki 登入電郵" />
            </div>
          </label>
          <Button className="self-end" type="button" disabled={busy || !email} onClick={() => void send("invite", { email })}>
            {busy ? "處理中…" : "建立家庭共享"}
          </Button>
        </div>
      ) : null}
      {message ? <p className="mt-3 text-sm font-semibold text-slate-700" role="status">{message}</p> : null}
    </section>
  );
}
