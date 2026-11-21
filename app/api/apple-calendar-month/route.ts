import { NextRequest } from "next/server";
import { requestedAppleCalendarMonth } from "@/lib/apple-calendar-month";
import { readAppleCalendarMonth } from "@/lib/server/apple-calendar-month";
import { authenticateRequest, privateJson } from "@/lib/server/request-context";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;

export async function GET(request:NextRequest) {
  const ctx=await authenticateRequest(request);
  if(ctx instanceof Response)return ctx;
  const window=requestedAppleCalendarMonth(request.nextUrl.searchParams);
  if(!window)return privateJson({error:"請提供一個有效月份；唔接受其他帳戶或日期範圍。"},400);
  try {
    const profile=await ctx.client.from("user_profiles").select("active").eq("user_id",ctx.user.id).maybeSingle();
    if(profile.error || !profile.data?.active)return privateJson({error:"帳戶未啟用。"},403);
    return privateJson(await readAppleCalendarMonth(ctx.user.id,window));
  }catch{
    return privateJson({error:"未能讀取呢個月嘅 iCloud 行程，請稍後再試。"},503);
  }
}
