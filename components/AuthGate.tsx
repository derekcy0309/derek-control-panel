"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AppShell } from "@/components/AppShell";
import { hasSupabaseConfig, supabase } from "@/lib/supabase";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"password" | "link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  async function sendLoginLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    setMessage(error ? formatLoginError(error.message) : "登入連結已發送，請到電郵信箱確認。");
  }

  async function signInWithPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!supabase) return;

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    setMessage(error ? formatPasswordLoginError(error.message) : "");
  }

  if (!hasSupabaseConfig) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mist px-4">
        <div className="panel max-w-lg p-6">
          <h1 className="text-2xl font-bold">需要設定 Supabase</h1>
          <p className="mt-3 text-base leading-7 text-slate-600">
            請先在環境變數加入 Supabase 網址和公開金鑰，然後重新啟動本機預覽。
          </p>
          <div className="mt-4 rounded-lg bg-slate-50 p-4 text-base text-slate-700">
            <p>NEXT_PUBLIC_SUPABASE_URL</p>
            <p>NEXT_PUBLIC_SUPABASE_ANON_KEY</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-lg font-semibold">載入中...</div>;
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mist px-4">
        <form className="panel w-full max-w-md p-6" onSubmit={authMode === "password" ? signInWithPassword : sendLoginLink}>
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold">登入 Derek 控制面板</h1>
          <p className="mt-2 text-base leading-7 text-slate-600">
            建議用密碼登入；登入連結容易被 Supabase 發送頻率限制擋住。
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
            <button
              className={`rounded-lg px-3 py-2 text-base font-semibold ${authMode === "password" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600"}`}
              type="button"
              onClick={() => setAuthMode("password")}
            >
              密碼登入
            </button>
            <button
              className={`rounded-lg px-3 py-2 text-base font-semibold ${authMode === "link" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600"}`}
              type="button"
              onClick={() => setAuthMode("link")}
            >
              登入連結
            </button>
          </div>
          <label className="mt-5 block">
            <span className="label">電郵地址</span>
            <input
              className="field mt-2"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="你的電郵地址"
              required
            />
          </label>
          {authMode === "password" ? (
            <label className="mt-4 block">
              <span className="label">密碼</span>
              <input
                className="field mt-2"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="你的 Supabase 使用者密碼"
                required
              />
            </label>
          ) : null}
          <Button className="mt-5 w-full" type="submit">
            {authMode === "password" ? "登入" : "發送登入連結"}
          </Button>
          {message ? <p className="mt-4 rounded-lg bg-indigo-50 p-3 text-base text-indigo-800">{message}</p> : null}
        </form>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}

function formatPasswordLoginError(message: string) {
  if (message.includes("Invalid login credentials")) {
    return "登入失敗：電郵或密碼不正確。請確認 Supabase Authentication > Users 裡已建立這個使用者，並已設定密碼。";
  }

  if (message.includes("Email not confirmed")) {
    return "登入失敗：這個電郵尚未確認。請到 Supabase Authentication > Users 將使用者設為已確認，或先完成確認電郵。";
  }

  if (message.includes("Email logins are disabled") || message.includes("provider is disabled")) {
    return "登入失敗：Supabase Email 登入尚未啟用。請到 Authentication > Providers 啟用 Email。";
  }

  return `登入失敗：${message}`;
}

function formatLoginError(message: string) {
  if (message.includes("signup") || message.includes("Signups not allowed")) {
    return "登入連結發送失敗：Supabase 目前不允許新使用者註冊。請到 Authentication 設定允許新註冊，或先在 Users 手動新增這個電郵。";
  }

  if (message.includes("Email logins are disabled") || message.includes("provider is disabled")) {
    return "登入連結發送失敗：Supabase Email 登入尚未啟用。請到 Authentication > Providers 啟用 Email。";
  }

  if (message.includes("rate limit") || message.includes("For security purposes")) {
    return "登入連結發送失敗：發送太頻密，請稍等一會再試。";
  }

  if (message.includes("redirect") || message.includes("URL")) {
    return "登入連結發送失敗：Supabase Redirect URL 未允許目前網址。請加入 http://127.0.0.1:3000 和 http://localhost:3000。";
  }

  return `登入連結發送失敗：${message}`;
}
