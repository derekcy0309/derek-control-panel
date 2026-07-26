import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export type AuthenticatedRequestContext = {
  client: SupabaseClient;
  user: User;
  token: string;
  origin: string;
};

export async function authenticateRequest(
  request: NextRequest
): Promise<AuthenticatedRequestContext | Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization") ?? "";
  const token =
    request.cookies.get("dcp_access")?.value
    ?? (authorization.startsWith("Bearer ") ? authorization.slice(7) : "");

  if (!url || !key) return privateJson({ error: "伺服器尚未設定資料庫。" }, 503);
  if (!token) return privateJson({ error: "登入已失效，請重新登入。" }, 401);

  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return privateJson({ error: "登入已失效，請重新登入。" }, 401);

  return { client, user: data.user, token, origin: request.nextUrl.origin };
}

export function privateJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
