// Run the real NextRequest handler and Supabase SDK against loopback only.
import assert from "node:assert/strict";
import http from "node:http";
import { registerHooks } from "node:module";
import { NextRequest } from "next/server.js";

const repo=new URL("../../",import.meta.url);
registerHooks({resolve(spec,ctx,next) {
  if(spec.startsWith("@/"))return {shortCircuit:true,url:new URL(spec.slice(2)+".ts",repo).href};
  return next(spec==="next/server"?"next/server.js":spec,ctx);
}});
const owner="11111111-1111-4111-8111-111111111111",id="22222222-2222-4222-8222-222222222222";
const start="https://derek-control-panel.vercel.app/#dayline-start";
let consent=false,reads=0,school=false,fixtureError;
const db=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,"http://localhost"),name=url.pathname.split("/").at(-1);
  const arg=url.searchParams,select=arg.get("select");
  let data=[];
  if(name==="agent_brief_owner"){ data=consent?owner:null; }
  else {
   reads++;assert.ok(consent,"no queries before verified agent_brief_owner");
   if(name==="school_bot_request")data={enabled:school,items:school?[{title:"回條",date:"2026-11-25"}]:[]};
   else {
    assert.equal(req.method,"GET");
    if(name==="tasks"||name==="operating_items"||name==="apple_calendar_connections")assert.equal(arg.get("owner_id"),"eq."+owner);
    if(name==="user_planning_metadata"){
     assert.equal(arg.get("user_id"),"eq."+owner);
     data=[{resource_id:id,plan_position:1,plan_source:"manual",plan_role:"now",snoozed_until:null}];
    }else if(name==="tasks"&&select==="title"){assert.equal(arg.get("id"),"eq."+id);data=[{title:"已安排跟進"}];}
    else if(name==="tasks"&&select?.includes("blocked_reason"))data=[{id,owner_id:owner,status:"not_started"}];
    else assert.ok(["tasks","operating_items","apple_calendar_connections","assignments","task_current_steps","task_dependencies"].includes(name));
   }
  }
  res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(data));
 }catch(e){fixtureError=e;res.writeHead(500);res.end();}
});
await new Promise(done=>db.listen(0,"127.0.0.1",done));
try{
 process.env.NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:"+db.address().port;
 process.env.SUPABASE_SERVICE_ROLE_KEY="fixture-not-a-key";
 const {GET}=await import("../../app/api/agent/brief/route.ts");
 const read=(auth,search="")=>GET(new NextRequest("https://dayline.test/api/agent/brief"+search,{headers:auth?{authorization:"Bearer dcp_grok_"+"x".repeat(43)}:{}}));
 assert.equal((await read(false)).status,401);assert.equal((await read(true)).status,403);
 assert.equal((await read(true,"?owner_id="+owner)).status,400);assert.equal(reads,0);
 consent=true;school=true;
 const response=await read(true);assert.equal(response.status,200);
 assert.match(response.headers.get("cache-control"),/private, no-store/);
 const report=await response.json();if(fixtureError)throw fixtureError;
 assert.equal(report.days.length,3);assert.match(report.text,/學校 Deadline/);
 assert.ok(report.text.endsWith("今日首項工作：已安排跟進｜登入日序開始工作："+start));
 assert.ok(!report.text.includes(owner)&&!report.text.includes(id));
 console.log("PASS real /api/agent/brief: verified consent first, fixed owner and generic human-login CTA, school and three-day report preserved.");
} finally {await new Promise(done=>db.close(done));}
