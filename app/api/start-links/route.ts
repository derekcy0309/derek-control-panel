import {createHash} from "node:crypto";
import {NextRequest} from "next/server";
import {privateJson} from "@/lib/server/request-context";
import {activeStartReader} from "@/lib/server/start-reader";
import {websiteAddress} from "@/lib/start-links";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const cols="id,title,url,shelf";
const markers=["site","later"];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function linkId(user:string,shelf:string,url:string) {
  const bytes=createHash("sha256").update(JSON.stringify(["dayline-web-v1",user,shelf,url])).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|0x80;bytes[8]=(bytes[8]&63)|0x80;
  const h=bytes.toString("hex");return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join("-");
}
export async function GET(req:NextRequest){
  const ctx=await activeStartReader(req);if(ctx instanceof Response)return ctx;
  if(req.nextUrl.search)return privateJson({error:"只可查看自己嘅收藏。"},400);
  const {data,error}=await ctx.client.from("dayline_web_links").select(cols).eq("owner_id",ctx.user.id).is("archived_at",null).order("updated_at",{ascending:false}).order("id").limit(121);
  if(error)return privateJson({error:"暫時讀唔到收藏，請重試。"},503);
  const rows=data??[];return privateJson({ownerId:ctx.user.id,links:rows.slice(0,120).filter(l=>websiteAddress(l.url)),more:rows.length>120});
}
export async function POST(req:NextRequest){
  if(req.headers.get("origin")!==req.nextUrl.origin)return privateJson({error:"請喺日序頁面操作。"},403);
  if(!req.headers.get("content-type")?.startsWith("application/json"))return privateJson({error:"請用網頁表單再試。"},415);
  const ctx=await activeStartReader(req);if(ctx instanceof Response)return ctx;
  const body=await req.json().catch(()=>null);if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(k=>!["action","id","title","url","shelf"].includes(k)))return privateJson({error:"收藏資料格式唔正確。"},400);
  if(body.action==="remove"){
    if(typeof body.id!=="string"||!uuid.test(body.id))return privateJson({error:"請選擇自己嘅收藏。"},422);
    const {data,error}=await ctx.client.from("dayline_web_links").update({archived_at:new Date().toISOString()}).eq("id",body.id).eq("owner_id",ctx.user.id).is("archived_at",null).select("id").maybeSingle();
    if(error)return privateJson({error:"未能移除，請重試。"},503);
    return data?privateJson({ok:true}):privateJson({error:"呢個收藏已移除，或唔屬於你。"},404);
  }
  const url=websiteAddress(body.url),shelf=body.shelf;
  if(body.action!=="save"||!url||!markers.includes(shelf)||typeof body.title!=="string"||body.title.trim().length>120)return privateJson({error:"請輸入有效網址，同最多 120 字嘅名稱。"},422);
  const title=body.title.trim()||new URL(url).hostname.slice(0,120),id=linkId(ctx.user.id,shelf,url);
  const row={id,owner_id:ctx.user.id,title,url,shelf};
  const insert=await ctx.client.from("dayline_web_links").upsert(row,{onConflict:"id",ignoreDuplicates:true});
  if(insert.error)return privateJson({error:"未能儲存，輸入仍然保留，請重試。"},503);
  const saved=await ctx.client.from("dayline_web_links").update({title,archived_at:null,updated_at:new Date().toISOString()}).eq("id",id).eq("owner_id",ctx.user.id).eq("shelf",shelf).select(cols).maybeSingle();
  const link=saved.data;
  if(saved.error||!link)return privateJson({error:"未能確認已儲存，請重試。"},503);
  return privateJson({link});
}
