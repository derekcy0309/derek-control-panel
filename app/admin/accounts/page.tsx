"use client";

import { AuthGate } from "@/components/AuthGate";
import { AdminAccountActivityPanel } from "@/components/AdminAccountActivityPanel";
import { LoadingState } from "@/components/LoadingState";
import { useControlData } from "@/hooks/useControlData";

export default function AdminAccountsPage() {
  return <AuthGate><AdminAccountsContent /></AuthGate>;
}

function AdminAccountsContent() {
  const { data, loading, error } = useControlData();
  if (loading || error || !data) return <LoadingState error={error} />;
  if (!data.profile.is_admin || !data.profile.active) {
    return <section className="panel max-w-2xl p-6"><p className="eyebrow">Access restricted</p><h1 className="page-title mt-1">這個頁面只供管理員使用</h1><p className="muted mt-3 leading-7">帳戶電郵及活動時間屬於管理資料，系統不會向一般帳戶顯示。</p></section>;
  }
  return <AdminAccountActivityPanel />;
}
