// Actual Next route + Supabase JS via loopback; run the real capture migration in disposable Postgres.
import assert from "node:assert/strict";
import http from "node:http";
import {readFile} from "node:fs/promises";
import {registerHooks} from "node:module";
import {pathToFileURL} from "node:url";
registerHooks({resolve(spec,ctx,next){return next(spec==="next/server"?"next/server.js":spec,ctx);}});
const {NextRequest}=await import("next/server.js");
const {POST}=await import("../../app/api/quick-capture/route.ts");
const {PGlite}=await import(process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE).href:"@electric-sql/pglite");
const pg=new PGlite();
const uid=["81000000-0000-4000-8000-000000000001","81000000-0000-4000-8000-000000000002"];
const key="81111111-0000-4000-8000-000000000001",origin="http://dayline.test";
let active=true,dbError=false,serverError,rpcs=0;
const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,origin),token=req.headers.authorization;
    assert.ok(["Bearer session-A","Bearer session-B"].includes(token));
    const actor=uid[Number(token.endsWith("B"))];
    let data;
    if(u.pathname==="/auth/v1/user")data={id:actor,email:"demo@example.test",aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{},created_at:"2026-11-25T00:00:00Z"};
    else if(u.pathname==="/rest/v1/user_profiles"){
      assert.equal(req.method,"GET");assert.equal(u.searchParams.get("select"),"active");assert.equal(u.searchParams.get("user_id"),"eq."+actor);data=[{active}];
    }else if(u.pathname==="/rest/v1/rpc/create_mobile_capture"){
      rpcs++;assert.equal(req.method,"POST");let raw="";for await(const chunk of req)raw+=chunk;
      if(dbError){res.writeHead(500,{"content-type":"application/json"});res.end(JSON.stringify({message:"test error"}));return;}
      const b=JSON.parse(raw);assert.deepEqual(Object.keys(b).sort(),["p_area","p_client_capture_id","p_description","p_source","p_source_url","p_target_user_id","p_title"]);
      assert.equal(b.p_target_user_id,null);assert.equal(b.p_area,"personal");assert.equal(b.p_source,"text");
      data=await pg.transaction(async tx=>{
        await tx.exec("set local role authenticated");await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
        return (await tx.query("select * from public.create_mobile_capture($1,$2,$3,$4,$5,$6,$7)",[b.p_client_capture_id,b.p_title,b.p_description,b.p_area,b.p_source,b.p_target_user_id,b.p_source_url])).rows[0];
      });
    }else throw Error("Unexpected access: "+req.method+" "+u.pathname);
    res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(data));
  }catch(e){serverError=e;res.writeHead(500);res.end("{}");}
});
function post(account=0,headers={},form={},legacy=false) {
  const data=new FormData();
  for(const [k,v] of Object.entries({clientCaptureId:key,title:"單行私人備忘",area:"personal",source:"text",...form}))data.set(k,v);
  return POST(new NextRequest(origin+"/api/quick-capture",{method:"POST",headers:{origin,cookie:"dcp_access=session-"+(account?"B":"A"),...(!legacy?{"x-dayline-account":uid[account]}:{}),...headers},body:data}));
}
try{
  await pg.exec(`
    create role anon; create role authenticated; create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    create table public.operating_items(id uuid primary key default gen_random_uuid(), item_type text, title text, description text,status text,area text, owner_id uuid,created_by_id uuid, visibility text,sensitive boolean,metadata jsonb,last_progress_at timestamptz);
    create function public.participant_profiles() returns table(user_id uuid) language sql as $$select null::uuid where false$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text);
    create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
  `);
  for(const who of uid)await pg.query("insert into auth.users values($1)",[who]);
  await pg.exec(await readFile(new URL("../../supabase/migrations/20260725210000_mobile_quick_capture.sql",import.meta.url),"utf8"));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  process.env.NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:"+server.address().port;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY="local-only";
  const first=await post();assert.equal(first.status,201,serverError?.message);
  assert.match(first.headers.get("cache-control"),/private, no-store/);
  const item=(await first.json()).item,retry=(await(await post()).json()).item;
  assert.deepEqual(Object.keys(item).sort(),["id","item_type","owner_id","title"]);assert.deepEqual(retry,item);
  const other=(await(await post(1)).json()).item;assert.notEqual(other.id,item.id);assert.equal(other.owner_id,uid[1]);
  assert.equal((await post(1,{"x-dayline-account":uid[0]})).status,409);
  assert.equal((await post(0,{origin:"https://elsewhere.test"})).status,403);
  assert.equal((await post(0,{cookie:""})).status,401);
  active=false;assert.equal((await post()).status,403);active=true;
  assert.equal((await post(0,{},{targetUserId:uid[1]})).status,422);
  assert.equal((await post(0,{},{title:"  "})).status,422);
  assert.equal(rpcs,3);
  dbError=true;assert.equal((await post()).status,500);dbError=false;
  assert.equal((await post(0,{}, {},true)).status,201); // Older mobile/PWA callers need no new header.
  assert.deepEqual((await pg.query("select owner_id,created_by_id,visibility,item_type from operating_items order by owner_id")).rows,
    uid.map(id=>({owner_id:id,created_by_id:id,visibility:"private",item_type:"inbox"})));
  await pg.query("update operating_items set title='已修改' where id=$1",[item.id]);assert.equal((await post()).status,409);
  assert.equal((await pg.query("select * from mobile_capture_receipts")).rows.length,2);
  assert.equal(serverError,undefined);
  console.log("PASS guide Inbox route and actual capture SQL: private rows, isolated idempotency keys, mismatch/origin/inactive/invalid input denied, safe retries, legacy compatibility.");
}finally{if(server.listening)await new Promise(r=>server.close(r));await pg.close();}
