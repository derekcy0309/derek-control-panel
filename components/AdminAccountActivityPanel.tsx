"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { loadAdminAccountUsers } from "@/lib/control-api";
import type { AdminAccountUser } from "@/lib/types";

export function AdminAccountActivityPanel() {
  const [users, setUsers] = useState<AdminAccountUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const result = await loadAdminAccountUsers();
      setUsers(result.users);
      setTruncated(result.truncated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能讀取帳戶活動。請再試一次。");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="panel p-5" aria-labelledby="admin-account-activity-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><UsersRound className="h-5 w-5" /></div>
          <div>
            <p className="eyebrow">Administrator</p>
            <h1 id="admin-account-activity-title" className="section-title mt-1">帳戶活動</h1>
            <p className="muted mt-2 text-sm leading-6">只供管理員查看帳戶狀態、上次登入及上次使用；不會顯示密碼或私人工作內容。</p>
          </div>
        </div>
        <Button type="button" variant="secondary" onClick={() => void load(true)} disabled={loading || refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />{refreshing ? "更新中…" : "重新整理"}
        </Button>
      </div>

      {loading ? <p className="mt-5 text-sm text-slate-600">正在安全讀取帳戶清單…</p> : null}
      {error ? <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">{error}</p> : null}
      {!loading && !error ? <AccountList users={users} /> : null}
      {truncated ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">帳戶超過 1,000 個，暫只顯示首 1,000 個。請聯絡系統維護人員協助匯出。</p> : null}
      <p className="mt-4 flex gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />「上次登入」來自安全登入紀錄；「上次使用」在帳戶完成認證的 Portal 操作後更新，最多每 5 分鐘一次。</p>
    </section>
  );
}

function AccountList({ users }: { users: AdminAccountUser[] }) {
  if (!users.length) return <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">暫時未有已建立的 Portal 帳戶。</p>;
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="min-w-[48rem] w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-[.08em] text-slate-500">
          <tr><th className="px-3 py-3">帳戶</th><th className="px-3 py-3">狀態</th><th className="px-3 py-3">建立日期</th><th className="px-3 py-3">上次登入</th><th className="px-3 py-3">上次使用</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((user) => (
            <tr key={user.id} className="align-top">
              <td className="px-3 py-4"><p className="font-bold text-slate-900">{user.displayName}</p><p className="mt-1 break-all text-slate-600">{user.email || "未有電郵"}</p></td>
              <td className="px-3 py-4"><AccountStatus user={user} /></td>
              <td className="px-3 py-4 text-slate-700">{formatDateTime(user.createdAt)}</td>
              <td className="px-3 py-4 text-slate-700">{formatDateTime(user.lastSignInAt, "未曾登入")}</td>
              <td className="px-3 py-4 text-slate-700">{formatDateTime(user.lastSeenAt, "新版尚未記錄")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountStatus({ user }: { user: AdminAccountUser }) {
  const labels = [user.active ? "已啟用" : "未啟用"];
  if (user.isAdmin) labels.push("管理員");
  if (!user.emailConfirmedAt) labels.push("待確認電郵");
  if (user.mustChangePassword) labels.push("待改密碼");
  return <div className="flex max-w-44 flex-wrap gap-1.5">{labels.map((label) => <span key={label} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{label}</span>)}</div>;
}

function formatDateTime(value: string | null, emptyLabel = "—") {
  if (!value) return emptyLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return emptyLabel;
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
