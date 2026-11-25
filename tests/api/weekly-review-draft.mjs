// Actual GET/POST handlers + Supabase SDK, restricted to a loopback fake PostgREST boundary.
import assert from "node:assert/strict";
import http from "node:http";
import {registerHooks} from "node:module";
const base=new URL("../../",import.meta.url);
registerHooks({resolve(spec,ctx,next){
  if(spec==="next/server"){
    const actual=next("next/server.js",ctx).url;
    return {url:"data:text/javascript,"+encodeURIComponent("export { NextRequest } from "+JSON.stringify(actual)+"; export function after(){}"),shortCircuit:true};
  }
  if(spec.startsWith("@/")) return {url:new URL(spec.slice(2)+".ts",base).href,shortCircuit:true};
  if(ctx.parentURL?.startsWith(base.href) && spec.startsWith(".") && !/\.\w+$/.test(spec)) return {url:new URL(spec+".ts",ctx.parentURL).href,shortCircuit:true};
  return next(spec,ctx);
}});
const {NextRequest}=await import("next/server.js");
const {GET,POST}=await import("../../app/api/control/route.ts");
const actor="ab100000-0000-4000-8000-000000000001",other=actor.replace(/1$/,"2");
const week="2026-11-23",origin="http://dayline.test",rows=new Map(),audits=[];
let version=0,failed;
const server=http.createServer(async(req,res)=>{
 try {
  const u=new URL(req.url,origin),uid=req.headers.authorization==="Bearer session-A"?actor:other,t=u.pathname.split("/").at(-1),verb=req.method;
  const out=(d,code=200)=>{res.writeHead(code,{"content-type":"application/json","content-range":"0-0/0"});res.end(JSON.stringify(d));};
  if(u.pathname==="/auth/v1/user")return out({id:uid,aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{},created_at:"2026-11-25T00:00:00Z"});
  if(t==="tasks"){assert.ok(verb==="HEAD"||verb==="GET","The review must never mutate tasks.");assert.equal(u.searchParams.get("owner_id"),"eq."+uid);return out([]);}
  let raw="";for await(const c of req)raw+=c;const doc=raw?JSON.parse(raw):null;
  if(t==="activity_logs"){assert.equal(verb,"POST");assert.equal(doc.actor_id,uid);assert.equal(doc.action,"weekly_review_completed");audits.push(doc.action);return out(null);}
  assert.equal(t,"weekly_reviews");
  const row=rows.get(uid);
  if(verb!=="POST"){assert.equal(u.searchParams.get("user_id"),"eq."+uid);if(verb==="PATCH"||!u.searchParams.has("order"))assert.equal(u.searchParams.get("week_start"),"eq."+week);}
  if(verb==="GET")return out(row?[row]:[]);
  if(verb==="POST"){
   assert.equal(doc.user_id,uid);assert.equal(doc.week_start,week);assert.ok(!req.headers.prefer?.includes("resolution=merge-duplicates"));
   if(row)return out({code:"23505",message:"duplicate"},409);
  }else{
   assert.equal(verb,"PATCH");assert.equal(u.searchParams.get("status"),"eq.draft");
   assert.ok(u.searchParams.get("updated_at")?.startsWith("eq."));
   if(!row||row.status!=="draft"||u.searchParams.get("updated_at")!=="eq."+row.updated_at)return out([]);
  }
  // Test microsecond revisions, like PostgreSQL's trigger.
  const next={id:uid,...row,...doc,updated_at:"2026-11-25T00:00:00."+String(++version).padStart(6,"0")+"+00:00"};rows.set(uid,next);return out(verb==="POST"?next:[next]);
 }catch(e){failed=e;res.writeHead(500);res.end("{}");}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
process.env.NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:"+server.address().port;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY="local-only";
const baseInput={action:"save_weekly_review",weekStart:week,expectedOwnerId:actor,expectedUpdatedAt:null,nextWeekOutcomes:["舊目標一","舊目標二"],nextWeekAvailableMinutes:155,rebalancingNote:"待覆",nextMinimumAction:"開文件",reflection:"每次一項",complete:false};
function post(fields={},uid=actor){return POST(new NextRequest(origin+"/api/control",{method:"POST",headers:{cookie:"dcp_access=session-"+(uid===actor?"A":"B"),origin,"content-type":"application/json"},body:JSON.stringify({...baseInput,...fields})}));}
try{
 const read=await GET(new NextRequest(origin+"/api/control?view=weekly_review&weekStart="+week,{headers:{cookie:"dcp_access=session-A"}}));assert.equal(read.status,200);assert.equal((await read.json()).owner_id,actor);
 const first=await post();assert.equal(first.status,200,failed?.message);const saved=(await first.json()).review;
 assert.equal((await post()).status,200);assert.equal(version,1); // lost create acknowledgement
 const edit={expectedUpdatedAt:saved.updated_at,reflection:"保留專注時段"};
 assert.equal((await post(edit)).status,200);assert.equal((await post(edit)).status,200);assert.equal(version,2); // lost update acknowledgement
 assert.deepEqual(rows.get(actor).next_week_outcomes,baseInput.nextWeekOutcomes);assert.equal(rows.get(actor).next_week_available_minutes,155);
 assert.equal((await post({...edit,reflection:"較舊的文字"})).status,409);assert.equal((await post({reflection:"誤以為尚無草稿"})).status,409);
 assert.equal((await post({expectedUpdatedAt:"2026-11-25"})).status,409);
 assert.equal((await post({expectedUpdatedAt:rows.get(actor).updated_at,rebalancingNote:undefined})).status,422);
 assert.equal((await post({},other)).status,409);assert.ok(!rows.has(other));assert.equal(version,2);
 const final={...edit,expectedUpdatedAt:rows.get(actor).updated_at,complete:true};assert.equal((await post(final)).status,200);assert.equal((await post(final)).status,200);
 assert.equal((await post({...edit,expectedUpdatedAt:rows.get(actor).updated_at})).status,409);assert.equal(version,3);assert.equal(audits.length,1);assert.equal(failed,undefined);
 console.log("PASS weekly review handlers: isolated owner, microsecond version checks, no missing-row upsert, no lost-update/new draft overwrite, repeat-safe completion, zero task mutations.");
}finally{await new Promise(r=>server.close(r));}
