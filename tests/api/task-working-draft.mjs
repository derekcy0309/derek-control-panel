// Invoke the actual route + authenticated Supabase client against a local-only PostgREST fixture.
import assert from "node:assert/strict";
import http from "node:http";
import {registerHooks} from "node:module";
const repo=new URL("../../",import.meta.url);
registerHooks({resolve(spec,ctx,next){
  if(["@/lib/server/start-reader","@/lib/server/request-context"].includes(spec)) return {url:new URL(spec.slice(2)+".ts",repo).href,shortCircuit:true};
  if(spec==="./request-context" && ctx.parentURL?.endsWith("/start-reader.ts")) return {url:new URL("./request-context.ts",ctx.parentURL).href,shortCircuit:true};
  return next(spec==="next/server"?"next/server.js":spec,ctx);
}});
const {NextRequest}=await import("next/server.js");
const {GET,POST}=await import("../../app/api/task-working-draft/route.ts");
const owners=["80230000-0000-4000-8000-000000000001","80230000-0000-4000-8000-000000000002"];
const task="81230000-0000-4000-8000-000000000003", inaccessible="81230000-0000-4000-8000-000000000004";
const all=new Map();const logs=[];let revoked=false,shared=false,failed,rev=0;
const db=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,"http://localhost"), uid=owners[req.headers.authorization==="Bearer session-A"?0:1];
    let data=null;
    const table=url.pathname.split("/").at(-1),verb=req.method;
    if(url.pathname==="/auth/v1/user") data={id:uid,email:"test@example.test",aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{},created_at:"2026-11-25T00:00:00Z"};
    else if(table==="touch_current_user_last_seen") data=null;
    else if(table==="user_profiles"){assert.equal(url.searchParams.get("user_id"),"eq."+uid);data=[{active:true}];}
    else if(table==="tasks"){assert.equal(verb,"GET");data=!revoked&&url.searchParams.get("id")==="eq."+task?[{id:task,title:"工作測試"}]:[];}
    else if(["share_records","assignments","joint_memberships"].includes(table)){
      assert.equal(verb,"GET");assert.equal(url.searchParams.get("resource_type"),"eq.operating_item");data=shared&&table==="share_records"?[{id:"shared"}]:[];
    } else if(table==="operating_items"){
      let raw="";for await(const chunk of req)raw+=chunk;
      const id=url.searchParams.get("id")?.slice(3);
      if(verb!=="POST"){assert.equal(url.searchParams.get("owner_id"),"eq."+uid);assert.equal(url.searchParams.get("item_type"),"eq.note");}
      if(verb==="GET"){const row=all.get(id);data=row?.owner_id===uid?[row]:[];}
      else if(verb==="POST"){
        const body=JSON.parse(raw);assert.equal(body.owner_id,uid);assert.equal(body.created_by_id,uid);assert.equal(body.visibility,"private");assert.equal(body.item_type,"note");assert.equal(body.area,"personal");assert.equal(body.sensitive,true);assert.equal(body.metadata.taskId,task);assert.ok(!all.has(body.id));
        const row={...body,updated_at:String(++rev)};all.set(row.id,row);data={updated_at:row.updated_at};
      }else if(verb==="PATCH"){
        const row=all.get(id);assert.equal(url.searchParams.get("updated_at"),"eq."+row.updated_at);assert.equal(url.searchParams.get("visibility"),"eq.private");
        const body=JSON.parse(raw);assert.deepEqual(Object.keys(body).sort(),["description","last_progress_at","updated_at"]);Object.assign(row,body,{updated_at:String(++rev)});data={updated_at:row.updated_at};
      }
    }else if(table==="activity_logs"){assert.equal(verb,"POST");let raw="";for await(const c of req)raw+=c;const log=JSON.parse(raw);assert.equal(log.summary,"儲存工作草稿");assert.equal(log.actor_id,uid);logs.push(log.action);}
    else throw Error("Unexpected table/mutation: "+verb+" "+table);
    res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(data));
  }catch(e){failed=e;res.writeHead(500);res.end("{}");}
});
await new Promise(resolve=>db.listen(0,"127.0.0.1",resolve));
process.env.NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:"+db.address().port;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY="local-only";
const origin="http://dayline.test";
function request(account,method,body,id=task,overrides={}){
  return new NextRequest(origin+"/api/task-working-draft?task="+id,{method,headers:{origin,"content-type":"application/json","x-dayline-account":owners[account],cookie:"dcp_access=session-"+(account?"B":"A"),...overrides},...(body?{body:JSON.stringify(body)}:{})});
}
async function read(account,expect){const r=await GET(request(account,"GET"));assert.equal(r.status,200);assert.match(r.headers.get("cache-control"),/private, no-store/);assert.deepEqual(await r.json(),expect);}
const write=(account,text,revision)=>POST(request(account,"POST",{text,revision}));
try{
  await read(0,{text:"",revision:null});
  const a=await write(0,"私人文字",null);assert.equal(a.status,200);const {revision}=await a.json();await read(0,{text:"私人文字",revision});await read(1,{text:"",revision:null});
  assert.equal((await write(0,"私人文字",null)).status,200);assert.equal(all.size,1);
  assert.equal((await write(0,"舊版本","old")).status,409);
  assert.equal((await write(1,"其他人私人文字",null)).status,200);assert.equal(all.size,2);
  assert.equal((await POST(request(1,"POST",{text:"錯帳戶",revision:null},task,{"x-dayline-account":owners[0]}))).status,409);
  assert.equal((await POST(request(0,"POST",{text:"",revision}))).status,422);
  assert.equal((await POST(request(0,"POST",{text:"x",revision,owner_id:owners[1]}))).status,422);
  assert.equal((await POST(request(0,"POST",{text:"x",revision},task,{origin:"http://elsewhere.test"}))).status,403);
  assert.equal((await GET(request(0,"GET",undefined,inaccessible))).status,404);
  assert.equal((await GET(request(0,"GET",undefined,task,{cookie:""}))).status,401);
  shared=true;assert.equal((await write(0,"改私人筆記",revision)).status,409);assert.equal((await GET(request(0,"GET"))).status,409);
  shared=false;assert.equal((await write(0,"第二版",revision)).status,200);
  revoked=true;assert.equal((await GET(request(0,"GET"))).status,404);
  assert.deepEqual(logs,["create","create","update"]);assert.equal(failed,undefined);
  console.log("PASS working-draft handlers: same-task different accounts, denied stale/share/revoked access, validation, idempotent retries and note-only writes.");
}finally{await new Promise(resolve=>db.close(resolve));}
