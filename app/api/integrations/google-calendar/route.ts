import { NextRequest } from "next/server";
import {
  decryptCalendarToken,
  googleAccountEmail,
  googleAccountHint,
  getValidGoogleAccessToken,
  listWritableGoogleCalendars,
  revokeGoogleToken,
  type ConnectedCalendarTarget,
  type GoogleConnection
} from "@/lib/integrations/google-calendar";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const connectionFields = "id,user_id,target,account_email,calendar_id,calendar_name,status,last_error,last_synced_at,access_expires_at,show_work_in_agenda";

export async function GET(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const connections = await context.client.from("google_calendar_connections")
    .select(connectionFields)
    .eq("user_id", context.user.id)
    .order("target");
  if (connections.error) return privateJson({ error: connections.error.message }, 500);
  const profile = await context.client.from("user_profiles").select("personal_calendar_email").eq("user_id", context.user.id).maybeSingle();
  if (profile.error) return privateJson({ error: profile.error.message }, 500);
  const personalCalendarEmail = profile.data?.personal_calendar_email;

  const target = request.nextUrl.searchParams.get("calendars") as ConnectedCalendarTarget | null;
  if (!target) {
    return privateJson({
      connections: connections.data ?? [],
      accountHints: {
        personal: googleAccountHint("personal", context.user.email ?? "", personalCalendarEmail),
        family: googleAccountHint("family", context.user.email ?? "", personalCalendarEmail),
        work: googleAccountHint("work", context.user.email ?? "", personalCalendarEmail)
      }
    });
  }
  const connection = (connections.data ?? []).find((item) => item.target === target);
  if (!connection) return privateJson({ error: "請先連接呢個 Google Calendar。" }, 404);
  try {
    const token = await getValidGoogleAccessToken(context.client, connection as GoogleConnection);
    const calendars = await listWritableGoogleCalendars(token);
    return privateJson({ calendars, selectedCalendarId: connection.calendar_id });
  } catch (error) {
    return privateJson({ error: error instanceof Error ? error.message : "未能讀取 Calendar。" }, 502);
  }
}

export async function POST(request: NextRequest) {
  const context = await authenticateRequest(request);
  if (context instanceof Response) return context;
  const body = await request.json().catch(() => null) as {
    action?: unknown;
    target?: unknown;
    calendarId?: unknown;
    calendarName?: unknown;
    accountEmail?: unknown;
    enabled?: unknown;
  } | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const target = typeof body?.target === "string" ? body.target as ConnectedCalendarTarget : null;
  if (!target || !["personal", "family", "work"].includes(target)) {
    return privateJson({ error: "Calendar 類型不正確。" }, 422);
  }
  const changingWorkAgenda = action === "set_work_agenda";
  const enabled = body?.enabled;
  if (changingWorkAgenda) {
    if (target !== "work" || typeof enabled !== "boolean") {
      return privateJson({ error: "工作 Calendar 嘅顯示設定不正確。" }, 422);
    }
    if (enabled && (typeof body?.calendarId !== "string" || typeof body?.accountEmail !== "string")) {
      return privateJson({ error: "請重新載入設定，確認想顯示嘅工作 Calendar。" }, 422);
    }
    if (!request.cookies.get("dcp_access")?.value ||
        request.headers.get("origin") !== request.nextUrl.origin ||
        !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return privateJson({ error: "請登入日序後喺設定頁操作。" }, 403);
    }
    const profile = await context.client.from("user_profiles").select("active").eq("user_id", context.user.id).maybeSingle();
    if (profile.error) return privateJson({ error: "暫時未能確認帳戶，請重試。" }, 503);
    if (profile.data?.active !== true || context.user.is_anonymous) {
      return privateJson({ error: "帳戶未啟用。" }, 403);
    }
  }
  const connection = await context.client.from("google_calendar_connections")
    .select("*")
    .eq("user_id", context.user.id)
    .eq("target", target)
    .maybeSingle();
  if (connection.error) return privateJson({ error: connection.error.message }, 500);
  if (!connection.data) return privateJson({ error: "Calendar 尚未連接。" }, 404);

  if (changingWorkAgenda) {
    if (enabled === true) {
      if (body?.calendarId !== connection.data.calendar_id || body?.accountEmail !== connection.data.account_email) {
        return privateJson({ error: "工作 Calendar 已更改；請重新載入設定再試。" }, 409);
      }
      if (connection.data.status !== "connected") {
        return privateJson({ error: "請先重新連接工作 Calendar。" }, 409);
      }
      try {
        const token = await getValidGoogleAccessToken(context.client, connection.data as GoogleConnection);
        const [accountEmail, calendars] = await Promise.all([googleAccountEmail(token), listWritableGoogleCalendars(token)]);
        if (accountEmail !== connection.data.account_email.toLowerCase()) {
          return privateJson({ error: "Google 授權帳戶同設定不符；請重新連接工作 Calendar。" }, 409);
        }
        if (!calendars.some((calendar) => calendar.id === connection.data.calendar_id)) {
          return privateJson({ error: "請先選擇你仍然有權限使用嘅工作 Calendar。" }, 403);
        }
      } catch {
        return privateJson({ error: "暫時未能驗證 Google Calendar 授權。請重試；如問題持續，請重新連接。" }, 502);
      }
    }
    let update = context.client.from("google_calendar_connections").update({
      show_work_in_agenda: enabled === true,
      updated_at: new Date().toISOString()
    }).eq("id", connection.data.id).eq("user_id", context.user.id).eq("target", "work");
    if (enabled === true) {
      update = update.eq("status", "connected").eq("calendar_id", connection.data.calendar_id).eq("account_email", connection.data.account_email);
    }
    const updated = await update.select(connectionFields).maybeSingle();
    if (updated.error) return privateJson({ error: "暫時未能儲存顯示設定，請重試。" }, 500);
    if (!updated.data) return privateJson({ error: "工作 Calendar 已更改；請重新載入設定再試。" }, 409);
    return privateJson({ connection: updated.data });
  }

  if (action === "select_calendar") {
    const calendarId = typeof body?.calendarId === "string" ? body.calendarId.trim() : "";
    const calendarName = typeof body?.calendarName === "string" ? body.calendarName.trim() : "";
    if (!calendarId || !calendarName) return privateJson({ error: "請選擇 Calendar。" }, 422);
    try {
      const token = await getValidGoogleAccessToken(context.client, connection.data as GoogleConnection);
      const calendars = await listWritableGoogleCalendars(token);
      const selected = calendars.find((calendar) => calendar.id === calendarId);
      if (!selected) return privateJson({ error: "你沒有寫入呢個 Calendar 嘅權限。" }, 403);
      const updated = await context.client.from("google_calendar_connections").update({
        calendar_id: selected.id,
        calendar_name: selected.summary,
        ...(target === "work" && selected.id !== connection.data.calendar_id ? { show_work_in_agenda: false } : {}),
        updated_at: new Date().toISOString()
      }).eq("id", connection.data.id).eq("user_id", context.user.id)
        .eq("calendar_id", connection.data.calendar_id).eq("account_email", connection.data.account_email)
        .select(connectionFields).maybeSingle();
      if (updated.error) return privateJson({ error: updated.error.message }, 500);
      if (!updated.data) return privateJson({ error: "Calendar 已更改；請重新載入設定再試。" }, 409);
      return privateJson({ connection: updated.data });
    } catch (error) {
      return privateJson({ error: error instanceof Error ? error.message : "未能選擇 Calendar。" }, 502);
    }
  }

  if (action === "disconnect") {
    const tokens = await context.client.rpc("read_google_calendar_tokens", {
      p_connection_id: connection.data.id
    });
    const stored = Array.isArray(tokens.data) ? tokens.data[0] : tokens.data;
    if (stored?.refresh_token_ciphertext) {
      try {
        await revokeGoogleToken(decryptCalendarToken(stored.refresh_token_ciphertext));
      } catch {
        // Local removal still proceeds when Google has already revoked the token.
      }
    }
    const removed = await context.client.from("google_calendar_connections")
      .delete()
      .eq("id", connection.data.id);
    if (removed.error) return privateJson({ error: removed.error.message }, 500);
    return privateJson({ disconnected: true });
  }
  return privateJson({ error: "不支援的 Calendar 操作。" }, 400);
}
