import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { DueSoonDigestEmail, type DueSoonEmailItem } from "@/emails/DueSoonDigestEmail";
import { isAuthorizedCronRequest } from "@/lib/server/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

let resendClient: Resend | null = null;

function getResend() {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not configured.");
  resendClient = new Resend(key);
  return resendClient;
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.CRON_SECRET;
  if (!url || !key || !secret || !process.env.RESEND_API_KEY) {
    return Response.json({ error: "Email digest server credentials are not configured." }, { status: 503 });
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const digestDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const claimed = await client.rpc("claim_due_email_digests", {
    p_secret: secret,
    p_digest_date: digestDate,
    p_limit: 20
  });
  if (claimed.error) {
    return Response.json({ error: "Unable to claim email digests." }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://derek-control-panel.vercel.app";
  const from = process.env.REMINDER_FROM_EMAIL
    || "Derek Control Panel <info@wecarenursing.com.hk>";
  const results = [];
  for (const row of claimed.data ?? []) {
    const items = (Array.isArray(row.items) ? row.items : []) as DueSoonEmailItem[];
    try {
      const response = await getResend().emails.send({
        from,
        to: row.recipient_email,
        subject: items.length
          ? `今日綜合跟進：${items.length} 項`
          : "今日暫時沒有需要跟進的事項",
        react: DueSoonDigestEmail({
          displayName: row.display_name,
          items,
          horizonDays: 3,
          appUrl
        })
      }, {
        idempotencyKey: `dcp-due-digest/${row.delivery_id}`
      });
      if (response.error) throw new Error(response.error.message);
      await client.rpc("complete_due_email_digest", {
        p_secret: secret,
        p_delivery_id: row.delivery_id,
        p_status: "sent",
        p_provider_message_id: response.data?.id ?? null,
        p_error: null
      });
      results.push({ deliveryId: row.delivery_id, status: "sent" });
    } catch (error) {
      await client.rpc("complete_due_email_digest", {
        p_secret: secret,
        p_delivery_id: row.delivery_id,
        p_status: "retry",
        p_provider_message_id: null,
        p_error: error instanceof Error ? error.message.slice(0, 1000) : "unknown"
      });
      results.push({ deliveryId: row.delivery_id, status: "retry" });
    }
  }
  return Response.json(
    { date: digestDate, claimed: claimed.data?.length ?? 0, results },
    { headers: { "Cache-Control": "no-store" } }
  );
}
