"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, Sparkles, Trash2, UsersRound } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { deleteAdminAccount, loadAdminAccountUsers, updateAdminEncouragementVisibility } from "@/lib/control-api";
import type { AdminAccountUser } from "@/lib/types";

export function AdminAccountActivityPanel() {
  const [users, setUsers] = useState<AdminAccountUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [busyUserId, setBusyUserId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminAccountUser | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const result = await loadAdminAccountUsers();
      setUsers(result.users);
      setTruncated(result.truncated);
      setCurrentUserId(result.currentUserId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能讀取帳戶活動。請再試一次。");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function setEncouragement(user: AdminAccountUser, visible: boolean) {
    setBusyUserId(user.id);
    setError("");
    setMessage("");
    try {
      await updateAdminEncouragementVisibility(user.id, visible);
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, showEncouragement: visible } : item));
      setMessage(`已${visible ? "開啟" : "關閉"} ${user.displayName} 的每頁鼓勵句。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能更新鼓勵句權限。");
    } finally {
      setBusyUserId("");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusyUserId(deleteTarget.id);
    setError("");
    setMessage("");
    try {
      await deleteAdminAccount(deleteTarget.id, confirmEmail);
      setUsers((current) => current.filter((item) => item.id !== deleteTarget.id));
      setMessage(`已永久刪除帳戶 ${deleteTarget.email}。`);
      setDeleteTarget(null);
      setConfirmEmail("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能安全刪除帳戶。");
    } finally {
      setBusyUserId("");
    }
  }

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
      {error && !deleteTarget ? <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">{error}</p> : null}
      {message ? <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">{message}</p> : null}
      {!loading ? <AccountList users={users} currentUserId={currentUserId} busyUserId={busyUserId} onEncouragementChange={setEncouragement} onDelete={(user) => { setDeleteTarget(user); setConfirmEmail(""); setError(""); }} /> : null}
      {truncated ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">帳戶超過 1,000 個，暫只顯示首 1,000 個。請聯絡系統維護人員協助匯出。</p> : null}
      <p className="mt-4 flex gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />「上次登入」來自安全登入紀錄；「上次使用」在帳戶完成認證的 Portal 操作後更新，最多每 5 分鐘一次。</p>
      {deleteTarget ? (
        <Modal title="永久刪除帳戶" onClose={() => { if (!busyUserId) { setDeleteTarget(null); setConfirmEmail(""); } }}>
          <div className="grid gap-4">
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-950">
              <p className="font-extrabold">此操作不能復原。</p>
              <p className="mt-1">系統會刪除 <strong>{deleteTarget.email}</strong> 的登入帳戶，以及所有以 cascade 連結的私人資料。若仍有受保護關聯或 Storage 檔案，伺服器會拒絕刪除。</p>
            </div>
            <label>
              <span className="label">輸入完整電郵確認</span>
              <input className="field mt-2" type="email" value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} placeholder={deleteTarget.email} autoFocus autoComplete="off" />
            </label>
            {error ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="bg-rose-700 hover:bg-rose-800" onClick={() => void confirmDelete()} disabled={busyUserId === deleteTarget.id || confirmEmail.trim().toLowerCase() !== deleteTarget.email.trim().toLowerCase()}>
                <Trash2 className="h-4 w-4" />{busyUserId === deleteTarget.id ? "刪除中…" : "永久刪除帳戶"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setDeleteTarget(null); setConfirmEmail(""); }} disabled={busyUserId === deleteTarget.id}>取消</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function AccountList({ users, currentUserId, busyUserId, onEncouragementChange, onDelete }: {
  users: AdminAccountUser[];
  currentUserId: string;
  busyUserId: string;
  onEncouragementChange: (user: AdminAccountUser, visible: boolean) => Promise<void>;
  onDelete: (user: AdminAccountUser) => void;
}) {
  if (!users.length) return <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">暫時未有已建立的 Portal 帳戶。</p>;
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="min-w-[68rem] w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-[.08em] text-slate-500">
          <tr><th className="px-3 py-3">帳戶</th><th className="px-3 py-3">狀態</th><th className="px-3 py-3">每頁鼓勵句</th><th className="px-3 py-3">建立日期</th><th className="px-3 py-3">上次登入</th><th className="px-3 py-3">上次使用</th><th className="px-3 py-3">帳戶操作</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((user) => (
            <tr key={user.id} className="align-top">
              <td className="px-3 py-4"><p className="font-bold text-slate-900">{user.displayName}</p><p className="mt-1 break-all text-slate-600">{user.email || "未有電郵"}</p></td>
              <td className="px-3 py-4"><AccountStatus user={user} /></td>
              <td className="px-3 py-4">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-fuchsia-50 px-3 py-2 font-bold text-fuchsia-800">
                  <input className="h-4 w-4 accent-fuchsia-600" type="checkbox" checked={user.showEncouragement} disabled={busyUserId === user.id} onChange={(event) => void onEncouragementChange(user, event.target.checked)} />
                  <Sparkles className="h-4 w-4" />{user.showEncouragement ? "顯示" : "隱藏"}
                </label>
              </td>
              <td className="px-3 py-4 text-slate-700">{formatDateTime(user.createdAt)}</td>
              <td className="px-3 py-4 text-slate-700">{formatDateTime(user.lastSignInAt, "未曾登入")}</td>
              <td className="px-3 py-4 text-slate-700">{formatDateTime(user.lastSeenAt, "新版尚未記錄")}</td>
              <td className="px-3 py-4">
                <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 px-3 font-bold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={user.id === currentUserId || busyUserId === user.id} onClick={() => onDelete(user)}>
                  <Trash2 className="h-4 w-4" />{user.id === currentUserId ? "目前帳戶" : "刪除帳戶"}
                </button>
              </td>
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
