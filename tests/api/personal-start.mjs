// Integration: real Next handlers, disposable per-user PostgREST stand-in. Never use live credentials.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
const port=3191,base='http://localhost:'+port,backend='http://127.0.0.1:4191',rows=new Map(),faults=[];
const ids={derek:'10000000-0000-4000-8000-000000000001',suki:'10000000-0000-4000-8000-000000000002',amigo:'10000000-0000-4000-8000-000000000003'};
const api=http.createServer(async(req,res)=>{
 let result=null,status=200;const u=new URL(req.url,backend),p=u.searchParams,actor=req.headers.authorization?.slice(7),id=ids[actor];
 try{if(u.pathname==='/auth/v1/user'){assert.ok(id);result={id,email:actor==='derek'?'derekcy0309@gmail.com':actor+'@example.test',email_confirmed_at:'2026-01-01',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01'};}
 else if(u.pathname.endsWith('/rpc/touch_current_user_last_seen'))result=null;
 else if(u.pathname.endsWith('/user_profiles')){assert.equal(p.get('user_id'),'eq.'+id);result=[{active:actor!=='amigo'}];}
 else if(u.pathname.endsWith('/dayline_info_choices')){assert.equal(p.get('user_id'),'eq.'+id);result=[];}
 else if(u.pathname.endsWith('/dayline_web_links')){
  if(req.method==='POST'){let txt='';for await(const c of req)txt+=c;const b=JSON.parse(txt);assert.equal(b.owner_id,id);assert.ok(['site','later'].includes(b.shelf));assert.ok(String(req.headers.prefer).includes('ignore-duplicates'));if(!rows.has(b.id))rows.set(b.id,{...b,archived_at:null});status=201;result=null;}
  else {assert.equal(p.get('owner_id'),'eq.'+id);
   let found=[...rows.values()].filter(v=>v.owner_id===id&&(!p.has('id')||p.get('id')==='eq.'+v.id)&&(!p.has('archived_at')||!v.archived_at));
   if(req.method==='PATCH'){let txt='';for await(const c of req)txt+=c;const b=JSON.parse(txt);for(const v of found)Object.assign(v,b);}
   result=req.headers.accept?.includes('vnd.pgrst.object')?found[0]??null:found;
  }}
 else {throw Error('Unexpected fixture path '+u.pathname);}
 if(req.headers.accept?.includes('vnd.pgrst.object')&&Array.isArray(result))result=result[0]??null;
 }catch(e){faults.push(e.message);status=500;result={error:'fixture assertion'};}
 res.writeHead(status,{'content-type':'application/json'}).end(result===null?'':JSON.stringify(result));
});
await new Promise(ok=>api.listen(4191,'127.0.0.1',ok));
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','-p',String(port)],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:backend,NEXT_PUBLIC_SUPABASE_ANON_KEY:'test-only',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',c=>logs=(logs+c).slice(-2000));server.stderr.on('data',c=>logs=(logs+c).slice(-2000));
function req(actor,path,body,origin=base){return fetch(base+path,{method:body?'POST':'GET',headers:{...(actor?{Cookie:'dcp_access='+actor}:{}),...(body?{Origin:origin,'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
try{
 for(let i=0;i<90;i++){if(server.exitCode!==null)throw Error(logs);try{if((await req(null,'/api/start-links')).status===401)break;}catch{}await new Promise(ok=>setTimeout(ok,400));}
 for(const route of ['/api/start-links','/api/briefing?section=local']){assert.equal((await req(null,route)).status,401);assert.equal((await req('amigo',route)).status,403);}
 const path='/api/start-links',input={action:'save',shelf:'site',title:'個人測試',url:'example.com/test'};
 assert.equal((await req('derek',path,input,'https://foreign.invalid')).status,403);
 assert.equal((await req('derek',path,{...input,owner_id:ids.suki})).status,400);
 assert.equal((await req('derek',path,{...input,url:'data:text/plain,test'})).status,422);
 const created=await req('derek',path,input);assert.equal(created.status,200);const id=(await created.json()).link.id;
 assert.equal((await req('derek',path,input)).status,200);assert.equal(rows.size,1);
 const own=await req('derek',path);assert.match(own.headers.get('cache-control'),/private.*no-store/);assert.equal((await own.json()).links[0].id,id);
 assert.deepEqual((await (await req('suki',path)).json()).links,[]);
 assert.equal((await req('suki',path,{action:'remove',id})).status,404);
 assert.equal((await req('derek',path,{action:'remove',id})).status,200);
 assert.deepEqual((await (await req('derek',path)).json()).links,[]);
 assert.equal((await req('derek',path,input)).status,200);assert.equal(rows.size,1);
 assert.equal((await req('derek',path+'?owner_id='+ids.suki)).status,400);
 assert.equal((await req('derek','/api/briefing?section=local&user_id=test')).status,400);
 assert.equal((await req('derek','/api/briefing?section=care')).status,403);
 assert.equal((await req('suki','/api/briefing?section=care')).status,403);
 assert.deepEqual((await(await req('derek','/api/information')).json()).prefs,{journals:false,news:false,traffic:false});
 assert.equal((await req(null,'/api/hk-traffic?vehicle=wrong')).status,400);
 assert.equal((await req(null,'/api/market-chart?index=6')).status,400);
 const chart=await fetch(base+'/api/market-chart?index=2',{redirect:'manual'});assert.equal(chart.status,302);const target=new URL(chart.headers.get('location'));assert.equal(target.origin,'https://www.tradingview-widget.com');assert.equal(chart.headers.get('referrer-policy'),'no-referrer');assert.match(decodeURIComponent(target.hash),/SP:SPX/);assert.doesNotMatch(decodeURIComponent(target.hash),/derek|cookie|page-uri/i);
 assert.deepEqual(faults,[]);console.log('PASS private links: anonymous/inactive denied, two owners isolated, foreign origin denied, idempotent writes, archive/re-save, chart allowlist.');
}finally{server.kill();await new Promise(done=>api.close(done));}
