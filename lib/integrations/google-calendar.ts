import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarTarget, OperatingItem } from "@/lib/types";

export type ConnectedCalendarTarget = Exclude<CalendarTarget, "none">;

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

export type GoogleConnection = {
  id: string;
  user_id: string;
  target: ConnectedCalendarTarget;
  account_email: string;
  calendar_id: string;
  calendar_name: string;
  access_expires_at: string | null;
  status: string;
};

export type GoogleCalendarListEntry = {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: "reader" | "writer" | "owner" | "freeBusyReader";
};

const oauthScopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.freebusy"
];

export function expectedGoogleAccount(
  target: ConnectedCalendarTarget,
  loginEmail: string,
  configuredCalendarEmail?: string | null
) {
  if (target === "work") {
    return (process.env.WORK_GOOGLE_ACCOUNT_EMAIL || "info@wecarenursing.com.hk").toLowerCase();
  }
  return configuredCalendarEmail?.trim().toLowerCase() || loginEmail.trim().toLowerCase();
}

export function createGoogleOAuthState(input: {
  userId: string;
  target: ConnectedCalendarTarget;
  returnTo?: string;
}) {
  const payload = Buffer.from(JSON.stringify({
    ...input,
    nonce: randomBytes(16).toString("hex"),
    issuedAt: Date.now()
  })).toString("base64url");
  const signature = createHmac("sha256", oauthStateSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGoogleOAuthState(value: string) {
  const [payload, suppliedSignature] = value.split(".");
  if (!payload || !suppliedSignature) return null;
  const expectedSignature = createHmac("sha256", oauthStateSecret()).update(payload).digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const result = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      userId: string;
      target: ConnectedCalendarTarget;
      returnTo?: string;
      issuedAt: number;
    };
    if (!["personal", "family", "work"].includes(result.target)) return null;
    if (Date.now() - result.issuedAt > 10 * 60_000) return null;
    return result;
  } catch {
    return null;
  }
}

export function googleAuthorizationUrl(input: {
  state: string;
  redirectUri: string;
  loginHint: string;
}) {
  const config = googleConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", oauthScopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const config = googleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Google OAuth token exchange failed (${response.status}).`);
  return response.json() as Promise<GoogleTokenResponse>;
}

export async function googleAccountEmail(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("未能確認 Google 帳戶電郵。");
  const body = await response.json() as { email?: string; email_verified?: boolean };
  if (!body.email || body.email_verified === false) throw new Error("Google 帳戶電郵未驗證。");
  return body.email.toLowerCase();
}

export async function listWritableGoogleCalendars(accessToken: string) {
  const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
  url.searchParams.set("minAccessRole", "writer");
  url.searchParams.set("maxResults", "100");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("未能讀取可寫入的 Google Calendar。");
  const body = await response.json() as { items?: GoogleCalendarListEntry[] };
  return (body.items ?? []).filter((calendar) => ["writer", "owner"].includes(calendar.accessRole));
}

export function encryptCalendarToken(value: string) {
  const key = tokenEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

export function decryptCalendarToken(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Calendar token 格式不正確。");
  const decipher = createDecipheriv("aes-256-gcm", tokenEncryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export async function getValidGoogleAccessToken(
  client: SupabaseClient,
  connection: GoogleConnection
) {
  const tokenResult = await client.rpc("read_google_calendar_tokens", {
    p_connection_id: connection.id
  });
  if (tokenResult.error) throw new Error(tokenResult.error.message);
  const stored = Array.isArray(tokenResult.data) ? tokenResult.data[0] : tokenResult.data;
  if (!stored?.access_token_ciphertext) throw new Error("Google Calendar 授權資料不存在。");
  const accessToken = decryptCalendarToken(stored.access_token_ciphertext);
  const expiresAt = connection.access_expires_at ? new Date(connection.access_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 60_000) return accessToken;
  if (!stored.refresh_token_ciphertext) throw new Error("Google Calendar 需要重新連接。");

  const refreshed = await refreshGoogleAccessToken(decryptCalendarToken(stored.refresh_token_ciphertext));
  const saved = await client.rpc("store_google_calendar_tokens", {
    p_connection_id: connection.id,
    p_access_token_ciphertext: encryptCalendarToken(refreshed.access_token),
    p_refresh_token_ciphertext: ""
  });
  if (saved.error) throw new Error(saved.error.message);
  await client.from("google_calendar_connections").update({
    access_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    status: "connected",
    last_error: null,
    updated_at: new Date().toISOString()
  }).eq("id", connection.id);
  return refreshed.access_token;
}

export async function syncConfirmedSchedule(
  client: SupabaseClient,
  userId: string,
  item: Pick<OperatingItem,
    "id" | "title" | "description" | "area" | "schedule_start_at" | "schedule_end_at"
    | "schedule_timezone" | "schedule_status" | "calendar_target" | "sensitive"
  >
) {
  const existingLink = await client.from("calendar_event_links")
    .select("*")
    .eq("operating_item_id", item.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (existingLink.error) throw new Error(existingLink.error.message);

  if (item.schedule_status !== "confirmed") {
    if (existingLink.data) {
      const connectionResult = await client.from("google_calendar_connections")
        .select("*")
        .eq("id", existingLink.data.connection_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (connectionResult.data) {
        const accessToken = await getValidGoogleAccessToken(client, connectionResult.data as GoogleConnection);
        await googleApi(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connectionResult.data.calendar_id)}/events/${encodeURIComponent(existingLink.data.google_event_id)}`,
          accessToken,
          { method: "DELETE", allowNotFound: true }
        );
      }
      const removedLink = await client.from("calendar_event_links")
        .delete()
        .eq("id", existingLink.data.id);
      if (removedLink.error) throw new Error(removedLink.error.message);
    }
    return { synced: false, reason: "not_confirmed" as const };
  }

  if (
    !item.schedule_start_at
    || !item.schedule_end_at
    || !item.calendar_target
    || item.calendar_target === "none"
  ) throw new Error("已確認行程欠缺時間或 Calendar 目標。");

  const connectionResult = await client.from("google_calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("target", item.calendar_target)
    .eq("status", "connected")
    .maybeSingle();
  if (connectionResult.error) throw new Error(connectionResult.error.message);
  if (!connectionResult.data) throw new Error("目標 Google Calendar 尚未連接。");
  const connection = connectionResult.data as GoogleConnection;
  const sameConnection = existingLink.data?.connection_id === connection.id;

  if (existingLink.data && !sameConnection) {
    const previousConnectionResult = await client.from("google_calendar_connections")
      .select("*")
      .eq("id", existingLink.data.connection_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (previousConnectionResult.data) {
      const previousAccessToken = await getValidGoogleAccessToken(
        client,
        previousConnectionResult.data as GoogleConnection
      );
      await googleApi(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(previousConnectionResult.data.calendar_id)}/events/${encodeURIComponent(existingLink.data.google_event_id)}`,
        previousAccessToken,
        { method: "DELETE", allowNotFound: true }
      );
    }
  }

  const accessToken = await getValidGoogleAccessToken(client, connection);
  const eventId = sameConnection
    ? existingLink.data!.google_event_id
    : stableGoogleEventId(item.id);
  const payload = {
    id: eventId,
    summary: item.sensitive ? "已確認私人行程" : item.title,
    description: item.sensitive ? "由 Derek Control Panel 同步。" : (item.description || "由 Derek Control Panel 同步。"),
    start: { dateTime: item.schedule_start_at, timeZone: item.schedule_timezone || "Asia/Hong_Kong" },
    end: { dateTime: item.schedule_end_at, timeZone: item.schedule_timezone || "Asia/Hong_Kong" },
    extendedProperties: { private: { dcpItemId: item.id, dcpArea: item.area } }
  };
  const calendarId = encodeURIComponent(connection.calendar_id);
  const endpoint = sameConnection
    ? `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`
    : `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  let event: { id: string; etag?: string };
  try {
    event = await googleApi(endpoint, accessToken, {
      method: sameConnection ? "PUT" : "POST",
      body: payload
    }) as { id: string; etag?: string };
  } catch (error) {
    if (sameConnection || !(error instanceof Error) || !error.message.includes("(409)")) throw error;
    event = await googleApi(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`,
      accessToken,
      { method: "PUT", body: payload }
    ) as { id: string; etag?: string };
  }
  const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const link = await client.from("calendar_event_links").upsert({
    user_id: userId,
    operating_item_id: item.id,
    connection_id: connection.id,
    google_event_id: event.id || eventId,
    etag: event.etag ?? null,
    sync_status: "synced",
    payload_hash: payloadHash,
    last_error: null,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: "operating_item_id" }).select("*").single();
  if (link.error) throw new Error(link.error.message);
  await client.from("google_calendar_connections").update({
    last_synced_at: new Date().toISOString(),
    last_error: null
  }).eq("id", connection.id);
  return { synced: true, link: link.data };
}

export async function revokeGoogleToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cache: "no-store"
  }).catch(() => undefined);
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const config = googleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Google Calendar 授權已失效，請重新連接。");
  return response.json() as Promise<GoogleTokenResponse>;
}

async function googleApi(
  url: string,
  accessToken: string,
  options: {
    method: "POST" | "PUT" | "DELETE";
    body?: unknown;
    allowNotFound?: boolean;
  }
) {
  const response = await fetch(url, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });
  if (options.allowNotFound && response.status === 404) return {};
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google Calendar 同步失敗 (${response.status})${detail ? `：${detail.slice(0, 180)}` : ""}`);
  }
  return response.status === 204 ? {} : response.json();
}

function stableGoogleEventId(itemId: string) {
  return `dcp${createHash("sha256").update(itemId).digest("hex").slice(0, 32)}`;
}

function googleConfig() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google Calendar OAuth 尚未設定。");
  return { clientId, clientSecret };
}

function oauthStateSecret() {
  const secret = process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("Google OAuth state secret 尚未安全設定。");
  return secret;
}

function tokenEncryptionKey() {
  const value = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error("Google token encryption key 尚未設定。");
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) throw new Error("Google token encryption key 必須是 32-byte base64 或 64 位 hex。");
  return decoded;
}
