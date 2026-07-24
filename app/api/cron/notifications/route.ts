import { timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type ClaimedNotification = {
  delivery_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  generic_title: string;
  generic_body: string;
  target_path: string;
  attempt_number: number;
};

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(authorization, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!supabaseUrl || !anonKey || !publicKey || !privateKey || !subject) {
    return Response.json({ error: "Notification service is not configured" }, { status: 503 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const now = new Date().toISOString();
  const queued = await client.rpc("enqueue_due_notifications", {
    p_dispatch_secret: secret,
    p_now: now
  });
  if (queued.error) return dispatchError("enqueue_failed");

  const batchId = crypto.randomUUID();
  const claimed = await client.rpc("claim_due_notifications", {
    p_dispatch_secret: secret,
    p_batch_id: batchId,
    p_limit: 50
  });
  if (claimed.error) return dispatchError("claim_failed");

  const rows = (claimed.data ?? []) as ClaimedNotification[];
  let sent = 0;
  let retry = 0;
  let failed = 0;
  for (const row of rows) {
    const payload = JSON.stringify({
      deliveryId: row.delivery_id,
      title: row.generic_title,
      body: row.generic_body,
      path: row.target_path
    });
    try {
      const response = await webpush.sendNotification({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth_key }
      }, payload, { TTL: 3600, urgency: "normal" });
      await completeAttempt(client, secret, row, "sent", response.statusCode, null);
      sent += 1;
    } catch (caught) {
      const statusCode = pushStatusCode(caught);
      const retryable = statusCode === null || statusCode === 408 || statusCode === 429 || statusCode >= 500;
      await completeAttempt(
        client,
        secret,
        row,
        retryable ? "retry" : "failed",
        statusCode,
        statusCode ? `push_http_${statusCode}` : "push_transport_error"
      );
      if (retryable) retry += 1;
      else failed += 1;
    }
  }

  return Response.json({
    ok: true,
    queued: Number(queued.data ?? 0),
    claimed: rows.length,
    sent,
    retry,
    failed
  }, {
    headers: { "Cache-Control": "no-store, private" }
  });
}

export async function GET() {
  return Response.json({ error: "Method not allowed" }, {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store, private" }
  });
}

async function completeAttempt(
  client: SupabaseClient,
  secret: string,
  row: ClaimedNotification,
  status: "sent" | "retry" | "failed",
  responseCode: number | null,
  errorCode: string | null
) {
  const result = await client.rpc("complete_notification_attempt", {
    p_dispatch_secret: secret,
    p_delivery_id: row.delivery_id,
    p_subscription_id: row.subscription_id,
    p_attempt_number: row.attempt_number,
    p_status: status,
    p_response_code: responseCode,
    p_error_code: errorCode
  });
  if (result.error) throw new Error("notification_attempt_update_failed");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function pushStatusCode(error: unknown) {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  const value = Number((error as { statusCode?: unknown }).statusCode);
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function dispatchError(code: string) {
  return Response.json({ error: code }, {
    status: 500,
    headers: { "Cache-Control": "no-store, private" }
  });
}
