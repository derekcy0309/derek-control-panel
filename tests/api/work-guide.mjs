// Real Next handlers + disposable loopback PostgREST/Auth stand-in. No production credentials.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
// NextRequest normalises a loopback browser origin to localhost.
const base='http://localhost:3168',origin='http://127.0.0.1:4186';
const uuid=n=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0');
const people={derek:uuid(1),suki:uuid(2),amigo:uuid(3)}, task=uuid(4), requestId=uuid(5);
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const rows=[],audit=[],faults=[],familyReads=[];
const fixture=http.createServer(async(req,res)=>{
 const u=new URL(req.url,origin),p=u.searchParams,t=u.pathname.split('/').at(-1),identity=req.headers.authorization?.slice(7),actor=people[identity];
 let result=[],status=200;
 try{
  if(u.pathname==='/auth/v1/user'){assert.ok(actor);result={id:actor,email:'fixture@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};}
  else if(t==='touch_current_user_last_seen')result=null;
  else if(t==='user_profiles'){assert.equal(p.get('user_id'),'eq.'+actor);result=[{active:true}];}
  else if(t==='apple_calendar_connections'){assert.equal(identity,'local-service');assert.ok(Object.values(people).includes(p.get('owner_id')?.slice(3)));result=[];}
  else if(t==='operating_items'){
   assert.ok(actor);assert.equal(p.get('owner_id'),'eq.'+actor);assert.equal(req.method,'GET');
   if(p.get('area')==='eq.family'){familyReads.push(actor);result=[{id:uuid(8),item_type:'school',title:identity+' school fixture',due_date:day}];}
  } else if(t==='tasks'){
   if(p.has('id'))result=actor===people.derek && p.get('id')==='eq.'+task?[{id:task}]:[];
   else if(p.has('owner_id')){assert.equal(p.get('owner_id'),'eq.'+actor);result=[{id:task,title:'deadline fixture',due_date:day,requested_priority:3,status:'not_started'}];}
  } else if(t==='task_steps'){assert.equal(p.get('task_id'),'eq.'+task);}
  else if(t==='task_checkpoints'){
    assert.equal(actor,people.derek);
    if(req.method==='POST'){
      let raw='';for await(const c of req)raw+=c;const item=JSON.parse(raw);
      assert.equal(item.author_id,actor);assert.equal(item.task_id,task);assert.equal(item.state,'saved');
      assert.equal(item.resource_links,undefined);
      if(rows.some(r=>r.id===item.id)){status=409;result={code:'23505',message:'fixture duplicate'};}
      else{rows.push(item);result=item;status=201;}
    }else{
      assert.equal(p.get('task_id'),'eq.'+task);assert.equal(p.get('state'),'eq.saved');
      if(p.has('id')){assert.equal(p.get('author_id'),'eq.'+actor);result=rows.filter(r=>'eq.'+r.id===p.get('id'));}
      else result=rows.slice(-1);
    }
  }else if(t==='activity_logs'){let raw='';for await(const c of req)raw+=c;audit.push(JSON.parse(raw));result=null;}
  else throw new Error('Unexpected fixture endpoint '+t);
 }catch(e){faults.push(String(e));status=500;result={message:'fixture assertion failed'};}
 res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
});
await new Promise((ok,fail)=>fixture.once('error',fail).listen(4186,'127.0.0.1',ok));
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','-p','3168'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:origin,NEXT_PUBLIC_SUPABASE_ANON_KEY:'local-anon',SUPABASE_SERVICE_ROLE_KEY:'local-service',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',c=>logs=(logs+c).slice(-5000));server.stderr.on('data',c=>logs=(logs+c).slice(-5000));
const read=(path,actor,opts={})=>fetch(base+path,{...opts,headers:{...(actor?{Cookie:'dcp_access='+actor}:{}),...opts.headers}});
const post=(actor,body)=>read('/api/control',actor,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'record_guide_step',...body})});
const guide='/api/control?view=work_guide&taskId='+task,payload={taskId:task,clientMutationId:requestId,completed:'opened the example',next:'resume example'};
try{
 for(let i=0;i<90;i++){if(server.exitCode!==null)throw new Error(logs);try{if((await fetch(base+'/api/auth')).status===401)break;}catch{}await new Promise(r=>setTimeout(r,400));}
 assert.equal((await read(guide)).status,401);
 assert.equal((await read('/api/control','derek',{method:'POST',headers:{Origin:'https://different.invalid','Content-Type':'application/json'},body:JSON.stringify({action:'record_guide_step',...payload})})).status,403);
 for(const actor of ['suki','amigo']){assert.equal((await read(guide,actor)).status,404);assert.equal((await post(actor,payload)).status,409);}
 assert.equal((await post('derek',{...payload,completed:'x'.repeat(5000)})).status,422);
 assert.equal((await read(guide,'derek')).status,200);
 assert.equal((await post('derek',payload)).status,201);assert.equal((await post('derek',payload)).status,200);
 assert.equal((await post('derek',{...payload,next:'different intent'})).status,409);assert.equal(rows.length,1);assert.equal(audit.length,1);
 assert.equal(JSON.stringify(audit).includes('opened the example'),false);
 assert.equal((await (await read(guide,'derek')).json()).checkpoint.next_minimum_step,payload.next);
 for(const actor of Object.keys(people)){const response=await read('/api/calendar-brief',actor);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);const b=await response.json();assert.equal(b.familyDates[0].title,actor+' school fixture');assert.equal(b.text.includes('school fixture'),false);}
 assert.deepEqual(familyReads,Object.values(people));assert.deepEqual(faults,[]);
 console.log('PASS actual guide/calendar handlers: auth, owner scope, retry idempotency, no draft/parent side effects, no private titles in audit or agent text, three isolated readers');
}finally{server.kill();await new Promise(ok=>fixture.close(ok));}
