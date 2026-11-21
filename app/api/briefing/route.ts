import {NextRequest} from "next/server";
import {privateJson} from "@/lib/server/request-context";
import {activeStartReader} from "@/lib/server/start-reader";
import {isNewsSection} from "@/lib/briefing";
import {getNewsGroups} from "@/lib/server/briefing-feeds";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=25;
export async function GET(req:NextRequest){
  const ctx=await activeStartReader(req);if(ctx instanceof Response)return ctx;
  const section=req.nextUrl.searchParams.get("section")??"local";
  if(!isNewsSection(section)||[...req.nextUrl.searchParams.keys()].some(k=>k!=="section"))return privateJson({error:"請選擇資訊分類。"},400);
  const choices=await ctx.client.from("dayline_info_choices").select("news").eq("user_id",ctx.user.id).maybeSingle();
  if(choices.error)return privateJson({error:"未能讀取資訊設定。"},503);
  if(!choices.data?.news)return privateJson({error:"公開新聞尚未開啟。"},403);
  const groups=await getNewsGroups(section);
  return privateJson({section,checkedAt:new Date().toISOString(),groups});
}
