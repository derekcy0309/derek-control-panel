import {NextRequest} from "next/server";
import {activeStartReader} from "@/lib/server/start-reader";
import {privateJson} from "@/lib/server/request-context";
import {isSeries,isUnreadCount,validBlocks} from "@/lib/publications";
export const dynamic="force-dynamic";
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function GET(req:NextRequest){
 const ctx=await activeStartReader(req);if(ctx instanceof Response)return ctx;
 const p=req.nextUrl.searchParams;const view=p.get("view")??"list";
 const fail=()=>privateJson({error:"刊物庫暫時未能更新。舊刊不會當成新刊，請稍後重試。"},503);
 const validKeys=(keys:string[])=>[...p.keys()].every(k=>keys.includes(k)&&p.getAll(k).length===1);
 if(view==="count"&&validKeys(["view"])){const r=await ctx.client.rpc("dayline_unread");return r.error||!isUnreadCount(r.data)?fail():privateJson({unread:r.data});}
 if(view==="issue"&&validKeys(["view","id"])&&uuid.test(p.get("id")??"")){
   const r=await ctx.client.rpc("dayline_issue",{issue:p.get("id")});if(r.error)return fail();
   if(!r.data)return privateJson({error:"刊物未開啟、唔存在，或帳戶未獲授權。"},404);
   return validBlocks(r.data.blocks)?privateJson({issue:r.data}):fail();
 }
 if(view!=="list"||!validKeys(["view","category","month","q","mode","offset"]))return privateJson({error:"請檢查刊物篩選。"},400);
 const category=p.get("category")||"all",month=p.get("month")||"",q=(p.get("q")||"").trim(),mode=p.get("mode")||"all",skip=p.get("offset")||"0";
 if((!isSeries(category)&&!["medical","all"].includes(category))||(month&&!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))||q.length>100||!["all","unread","saved"].includes(mode)||!/^\d{1,6}$/.test(skip)||+skip>100000)return privateJson({error:"請檢查月份或搜尋字眼。"},422);
 const r=await ctx.client.rpc("dayline_issues",{category,month_key:month,term:q,mode,skip_count:+skip});if(r.error)return fail();
 const rows=r.data??[];return privateJson({items:rows.slice(0,25),more:rows.length>25});
}
export async function POST(req:NextRequest){
 if(req.headers.get("origin")!==req.nextUrl.origin||!req.headers.get("content-type")?.startsWith("application/json"))return privateJson({error:"請喺刊物庫內操作。"},403);
 const ctx=await activeStartReader(req);if(ctx instanceof Response)return ctx;
 const b=await req.json().catch(()=>null);if(!b||!uuid.test(b.id)||Object.keys(b).some(k=>!["id","action","wanted","seen"].includes(k))||
 !((b.action==="read"&&typeof b.seen==="string"&&/^[a-f0-9]{64}$/.test(b.seen))||(b.action==="save"&&typeof b.wanted==="boolean")))return privateJson({error:"請重新打開刊物。"},422);
 const r=await ctx.client.rpc("dayline_issue_state",{issue:b.id,action:b.action,wanted:b.action==="save"?b.wanted:null,seen:b.action==="read"?b.seen:null});
 return r.error?privateJson({error:"狀態未能儲存，請重新載入再試。"},r.error.code==="42501"?404:503):privateJson({ok:true});
}
