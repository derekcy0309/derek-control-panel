export const GOOGLE_FLOW_COOKIE = "dcp_google_flow";
export const GOOGLE_FLOW_SECONDS = 10 * 60;
export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

export type GoogleLoginFlow = {
  verifier: string;
  state: string;
  next: string;
  createdAt: number;
};

// Never accept an external redirect, an API endpoint or another login callback.
export function safeLoginDestination(value: unknown): string {
  if (typeof value !== "string" || value.length > 1500 || !value.startsWith("/")) return "/";
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return "/"; }
  if (/^[\/]{2}|[\\\u0000-\u0020]/.test(decoded)) return "/";
  const parsed = new URL(value, "https://panel.invalid");
  if (parsed.origin !== "https://panel.invalid" || /^\/(api|auth)(\/|$)/i.test(decodeURIComponent(parsed.pathname))) return "/";
  // Query strings can contain old login codes/tokens. Return to the page only.
  return parsed.pathname;
}

export function readGoogleFlow(value: string | undefined, now = Date.now()): GoogleLoginFlow | null {
  if (!value || value.length > 3000) return null;
  try {
    const flow = JSON.parse(value) as Partial<GoogleLoginFlow>;
    if (typeof flow.verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(flow.verifier)
      || typeof flow.state !== "string" || !/^[a-f0-9]{64}$/.test(flow.state)
      || typeof flow.createdAt !== "number" || !Number.isFinite(flow.createdAt)
      || flow.createdAt > now || now - flow.createdAt > GOOGLE_FLOW_SECONDS * 1000) return null;
    return { verifier: flow.verifier, state: flow.state, createdAt: flow.createdAt, next: safeLoginDestination(flow.next) };
  } catch { return null; }
}

export function googleLoginError(code: string | null): string {
  switch (code) {
    case "cancelled": return "已取消 Google 登入。想繼續時，再按「使用 Google 登入」即可。";
    case "unavailable": return "Google 登入尚未完成設定。請暫用下方其他登入方法，或請管理員啟用 Supabase Google provider。";
    case "closed_registration_required": return "Google 登入暫未開放，請管理員先關閉自行註冊，保障現有私人帳戶。";
    case "expired": return "登入程序已過期或來自另一個瀏覽器。請在同一個視窗重新按「使用 Google 登入」。";
    case "account": return "這個 Google 帳戶未連結可使用的 Panel 帳戶。請選擇與原有帳戶相同的電郵，或聯絡管理員。";
    case "network": return "暫時未能連線。請檢查網絡後再試；原有帳戶資料沒有改動。";
    default: return "未能完成 Google 登入。請重新選擇原有帳戶；仍有問題可暫用其他登入方法。";
  }
}

export function googleProviderReady(settings: unknown): "ready" | "unavailable" | "closed_registration_required" {
  if (!settings || typeof settings !== "object") return "unavailable";
  const value = settings as { external?: { google?: boolean }; disable_signup?: boolean };
  if (value.external?.google !== true) return "unavailable";
  // Google OAuth has no shouldCreateUser:false option. Fail closed if the
  // project permits public registrations; administrators can still invite users.
  return value.disable_signup === true ? "ready" : "closed_registration_required";
}
