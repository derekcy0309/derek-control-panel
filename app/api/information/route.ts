import {NextRequest} from "next/server";
import {activeStartReader} from "@/lib/server/start-reader";
import {privateJson} from "@/lib/server/request-context";
import {off,isInfoKey} from "@/lib/publications";
import {defaultRoads,validRoads} from "@/lib/road-presets";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const ctx=await activeStartReader(req);if(ctx instanceof Response)return ctx;
 if(req.nextUrl.search)return privateJson({error:"只可讀取自己嘅設定。"},400);
 const r=await ctx.client.from("dayline_info_choices").select("journals,news,traffic,road_presets").eq("user_id",ctx.user.id).maybeSingle();
 if(r.error)return privateJson({error:"暫時讀唔到資訊設定。未有開啟任何資訊。"},503);
 const row=r.data;return privateJson({prefs:row?{journals:row.journals,news:row.news,traffic:row.traffic}:off,routes:validRoads(row?.road_presets)?row.road_presets:defaultRoads});
}
export async function POST(req:NextRequest){
 if(req.headers.get("origin")!==req.nextUrl.origin||!req.headers.get("content-type")?.startsWith("application/json"))return privateJson({error:"請喺日序設定。"},403);
 const ctx=await activeStartReader(req);if(ctx instanceof Response)return ctx;
 const b=await req.json().catch(()=>null);
 if(b&&Object.keys(b).length===1&&validRoads(b.routes)){const result=await ctx.client.rpc("dayline_set_routes",{routes:b.routes});return result.error?privateJson({error:"未能儲存路段，請重試。"},503):privateJson({ok:true});}
 if(!b||Object.keys(b).length!==2||!isInfoKey(b.choice)||typeof b.enabled!=="boolean")return privateJson({error:"請揀有效設定。"},422);
 const r=await ctx.client.rpc("dayline_set_info",{choice:b.choice,enabled:b.enabled});return r.error?privateJson({error:"未能儲存設定，請重試。"},503):privateJson({ok:true});
}
