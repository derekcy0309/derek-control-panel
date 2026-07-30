"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AppShell } from "@/components/AppShell";
import { hasSupabaseConfig, supabase } from "@/lib/supabase";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"password" | "otp">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  useEffect(() => {
    let active = true;
    let refreshInFlight = false;
    async function renewSession({ initial = false, adoptBrowserSession = false }: { initial?: boolean; adoptBrowserSession?: boolean } = {}) {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        const linkSession = adoptBrowserSession ? await supabase?.auth.getSession() : null;
        if (linkSession?.data.session) {
          const adopted = await fetch("/api/auth", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
            body: JSON.stringify({ action: "adopt", accessToken: linkSession.data.session.access_token, refreshToken: linkSession.data.session.refresh_token })
          });
          if (adopted.ok) {
            // Do not call Supabase signOut here.  A local sign-out also invalidates the
            // refresh token remotely, which logs the user out immediately after a
            // magic/recovery link has successfully created our HttpOnly-cookie session.
            // A full navigation clears this non-persistent browser client session and
            // removes the one-time link fragment without ending the adopted session.
            window.location.replace(window.location.pathname);
            return;
          }
          if (window.location.hash || window.location.search.includes("code=")) window.history.replaceState({}, "", window.location.pathname);
        }
        const response = await fetch("/api/auth", { cache: "no-store", credentials: "same-origin" });
        if (response.ok && active) setAuthenticated(true);
        // A temporary network error must not throw the user back to the login
        // screen.  A missing/revoked refresh token is handled on the next full
        // sign-in check, without silently clearing any local work.
        if (!response.ok && initial && active) setAuthenticated(false);
      } catch {
        // Keep an existing authenticated screen in place while offline.
      } finally {
        refreshInFlight = false;
        if (initial && active) setLoading(false);
      }
    }
    void renewSession({ initial: true, adoptBrowserSession: true });
    const keepAlive = window.setInterval(() => { void renewSession(); }, 20 * 60 * 1000);
    const renewWhenReturning = () => {
      if (document.visibilityState === "visible") void renewSession();
    };
    window.addEventListener("focus", renewWhenReturning);
    document.addEventListener("visibilitychange", renewWhenReturning);
    return () => {
      active = false;
      window.clearInterval(keepAlive);
      window.removeEventListener("focus", renewWhenReturning);
      document.removeEventListener("visibilitychange", renewWhenReturning);
    };
  }, []);

  async function sendLoginCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!supabase) return;
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin, shouldCreateUser: false } });
    setSubmitting(false);
    if (error) { setMessage(formatLoginError(error.message)); return; }
    setOtpSent(true);
    setMessage("登入電郵已發送。請輸入 6 位驗證碼；如電郵顯示安全登入連結，亦可直接按連結登入。");
  }

  async function verifyLoginCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!supabase || !otpCode.trim()) return;
    setSubmitting(true);
    const verified = await supabase.auth.verifyOtp({ email, token: otpCode.trim(), type: "email" });
    if (verified.error || !verified.data.session) {
      setSubmitting(false);
      setMessage("驗證碼不正確或已過期，請重新發送。");
      return;
    }
    const adopted = await fetch("/api/auth", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ action: "adopt", accessToken: verified.data.session.access_token, refreshToken: verified.data.session.refresh_token })
    });
    setSubmitting(false);
    if (!adopted.ok) { setMessage("驗證成功，但未能建立安全登入 session。請再試一次。"); return; }
    // Reload from the HttpOnly-cookie session.  Calling the Supabase client
    // signOut here can invalidate the refresh token that was just adopted.
    window.location.replace(window.location.pathname);
  }

  async function signInWithPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);
    const response = await fetch("/api/auth", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ action: "password", email, password })
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setSubmitting(false);
    if (!response.ok) { setMessage(result.error || "登入失敗，請再試一次。"); return; }
    setPassword("");
    setAuthenticated(true);
  }

  if (!hasSupabaseConfig) {
    return <CenteredPanel title="需要設定 Supabase">請先加入 Supabase 網址和公開金鑰，然後重新啟動預覽。</CenteredPanel>;
  }
  if (loading) return <div className="grid min-h-screen place-items-center bg-mist" role="status"><div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" /><span className="sr-only">正在檢查登入</span></div>;
  if (authenticated) return <AppShell>{children}</AppShell>;

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-mist px-4 py-8">
      <div className="pointer-events-none absolute left-1/2 top-[-12rem] h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-indigo-200/35 blur-3xl" />
      <form className="panel relative w-full max-w-md p-6 sm:p-8" onSubmit={authMode === "password" ? signInWithPassword : otpSent ? verifyLoginCode : sendLoginCode}>
        <div className="mb-6 flex items-center gap-3"><div className="brand-mark h-11 w-11"><KeyRound className="h-5 w-5" /></div><div><p className="eyebrow">Derek Control Panel</p><h1 className="text-2xl font-bold tracking-tight">登入你的 Panel</h1></div></div>
        <p className="text-sm leading-6 text-slate-600">每個帳戶的 Dashboard、私人資料、排序及設定完全獨立。所有內容預設只限自己查看。</p>
        <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
          <button className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${authMode === "password" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600"}`} type="button" onClick={() => { setAuthMode("password"); setOtpSent(false); }}>密碼登入</button>
          <button className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${authMode === "otp" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600"}`} type="button" onClick={() => setAuthMode("otp")}>Email 登入</button>
        </div>
        <label className="mt-5 block"><span className="label">電郵地址</span><input className="field mt-2" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        {authMode === "password" ? (
          <label className="mt-4 block"><span className="label">密碼</span><div className="relative mt-2"><input className="field pr-12" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /><button className="absolute inset-y-0 right-0 grid min-w-11 place-items-center text-slate-500" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}>{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button></div></label>
        ) : otpSent ? <label className="mt-4 block"><span className="label">6 位驗證碼（如電郵提供）</span><input className="field mt-2" inputMode="numeric" autoComplete="one-time-code" value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></label> : null}
        <Button className="mt-5 w-full" type="submit" disabled={submitting}>{submitting ? "處理中…" : authMode === "password" ? "登入" : otpSent ? "驗證並登入" : "發送登入電郵"}</Button>
        {authMode === "otp" && otpSent ? <button className="mt-3 min-h-11 w-full text-sm font-semibold text-indigo-700" type="button" onClick={() => { setOtpSent(false); setOtpCode(""); setMessage(""); }}>重新發送登入電郵</button> : null}
        {message ? <p className="mt-4 rounded-xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-800" role="alert">{message}</p> : null}
        <div className="mt-5 flex items-start gap-2 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p>登入資料使用 HttpOnly cookie 保存；敏感 session 不會寫入 localStorage。</p></div>
      </form>
    </div>
  );
}

function CenteredPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center bg-mist px-4"><div className="panel max-w-lg p-6"><h1 className="text-2xl font-bold">{title}</h1><p className="mt-3 leading-7 text-slate-600">{children}</p></div></div>;
}

function formatLoginError(message: string) {
  if (message.includes("rate limit") || message.includes("For security purposes")) return "發送太頻密，請稍等一會再試。";
  if (message.includes("disabled")) return "Supabase Email 登入尚未啟用。";
  if (message.includes("redirect") || message.includes("URL")) return "目前網址尚未加入 Supabase Redirect URL。";
  return "未能發送登入電郵，請稍後再試。";
}
