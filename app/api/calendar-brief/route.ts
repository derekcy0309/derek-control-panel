import { NextRequest } from "next/server";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";
import { readCalendarBrief } from "@/lib/server/calendar-brief";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function GET(request:NextRequest) {
 if(request.nextUrl.search) return privateJson({error:"摘要不接受其他用戶或自訂日期參數。"},400);
 const ctx=await authenticateRequest(request);if(ctx instanceof Response)return ctx;
 const profile=await ctx.client.from("user_profiles").select("active").eq("user_id",ctx.user.id).maybeSingle();
 if(profile.error||!profile.data?.active)return privateJson({error:"帳戶未啟用。"},403);
 try {return privateJson(await readCalendarBrief(ctx.user.id,ctx.client));}
 catch {return privateJson({error:"未能安全讀取三日安排。請重試；現有資料沒有改動。"},503);}
}
