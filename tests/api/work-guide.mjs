// Real Next handlers + disposable loopback PostgREST/Auth stand-in. No production credentials.
import assert from 'node:assert/strict';
import http from 'node:http';
import {registerHooks} from 'node:module';
// Exercise the actual handlers in-process without writing to Next's build directory.
const root=new URL('../../',import.meta.url);
// Only Next's post-response callback needs an HTTP server's request scope.
// In this harness run that same best-effort heartbeat on the microtask queue.
const fixtureServer='data:text/javascript,'+encodeURIComponent('export * from '+JSON.stringify(import.meta.resolve('next/server.js'))+'; export const after=(callback)=>queueMicrotask(callback);');
registerHooks({resolve(spec,ctx,next){
 if(spec==='next/server')return {url:fixtureServer,shortCircuit:true};
 if(spec.startsWith('@/'))return next(new URL(spec.slice(2)+(/\.\w+$/.test(spec)?'':'.ts'),root).href,ctx);
 if(spec.startsWith('.') && !/\.\w+$/.test(spec) && ctx.parentURL?.startsWith(root.href) && !ctx.parentURL.includes('/node_modules/'))return next(spec+'.ts',ctx);
 return next(spec,ctx);
}});
const base='http://dayline.test',origin='http://127.0.0.1:4186';
process.env.NEXT_PUBLIC_SUPABASE_URL=origin;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='local-anon';process.env.SUPABASE_SERVICE_ROLE_KEY='local-service';
const {NextRequest}=await import('next/server.js');
const control=await import('../../app/api/control/route.ts'),calendar=await import('../../app/api/calendar-brief/route.ts');
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
  else if(t==='google_calendar_connections'){assert.equal(p.get('user_id'),'eq.'+actor);assert.equal(p.get('target'),'eq.work');assert.equal(req.method,'GET');result=[];}
  else if(t==='apple_calendar_connections'){assert.equal(identity,'local-service');assert.ok(Object.values(people).includes(p.get('owner_id')?.slice(3)));result=[];}
  else if(t==='operating_items'){
   assert.ok(actor);assert.equal(p.get('owner_id'),'eq.'+actor);assert.equal(req.method,'GET');
   if(p.get('area')==='eq.family'&&p.get('item_type')==='eq.school'){
     assert.equal(p.get('limit'),'1');assert.equal(p.get('archived_at'),'is.null');assert.equal(p.get('select'),'id,title,due_date');
     const threshold=p.get('due_date').slice(4);assert.ok(threshold>day);result=[{id:uuid(17),title:identity+' next school',due_date:threshold}];
   }else if(p.get('area')==='eq.family'){familyReads.push(actor);result=[{id:uuid(8),item_type:'school',title:identity+' school fixture',due_date:day}];}
   else if(p.get('schedule_status')==='in.(confirmed)'){assert.equal(p.get('item_type'),'eq.event');result=[{id:uuid(9),title:identity+' timed fixture',schedule_status:'confirmed',schedule_start_at:day+'T15:30:00+08:00',schedule_end_at:day+'T16:00:00+08:00'}];}
  } else if(t==='tasks'){
   if(p.has('id'))result=actor===people.derek && p.get('id')==='eq.'+task?[{id:task,owner_id:actor,status:'in_progress'}]:[];
   else if(p.has('owner_id')){assert.equal(p.get('owner_id'),'eq.'+actor);result=[{id:task,title:'deadline fixture',due_date:day,requested_priority:3,status:'not_started'}];}
  } else if(t==='task_steps'){assert.equal(p.get('task_id'),'eq.'+task);if(p.has('id')&&p.get('id')==='eq.'+uuid(20))result=[{sort_order:12,status:'todo',title:'step example',updated_at:'2026-11-25T12:00:00Z'}];}
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
  }else if(t==='task_resources'||t==='task_checkpoint_resources'){assert.equal(req.method,'GET');assert.ok(actor);assert.equal(p.get('task_id'),'eq.'+task);result=[];}
  else if(t==='activity_logs'){let raw='';for await(const c of req)raw+=c;audit.push(JSON.parse(raw));result=null;}
  else throw new Error('Unexpected fixture endpoint '+t);
 }catch(e){faults.push(String(e));status=500;result={message:'fixture assertion failed'};}
 res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
});
await new Promise((ok,fail)=>fixture.once('error',fail).listen(4186,'127.0.0.1',ok));
const read=(path,actor,opts={})=>(path.startsWith('/api/control')?control:calendar)[opts.method||'GET'](new NextRequest(base+path,{...opts,headers:{...(actor?{Cookie:'dcp_access='+actor}:{}),...opts.headers}}));
const post=(actor,body)=>read('/api/control',actor,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'record_guide_step',...body})});
const guide='/api/control?view=work_guide&taskId='+task,payload={taskId:task,clientMutationId:requestId,completed:'opened the example',next:'resume example'};
try{
 assert.equal((await read(guide)).status,401);
 assert.equal((await read('/api/control','derek',{method:'POST',headers:{Origin:'https://different.invalid','Content-Type':'application/json'},body:JSON.stringify({action:'record_guide_step',...payload})})).status,403);
 for(const actor of ['suki','amigo']){assert.equal((await read(guide,actor)).status,404);assert.equal((await post(actor,payload)).status,409);}
 assert.equal((await post('derek',{...payload,completed:'x'.repeat(5000)})).status,422);
 assert.equal((await read(guide,'derek')).status,200);
 assert.equal((await post('derek',payload)).status,201);assert.equal((await post('derek',payload)).status,200);
 assert.equal((await post('derek',{...payload,next:'different intent'})).status,409);assert.equal(rows.length,1);assert.equal(audit.length,1);
 assert.equal(JSON.stringify(audit).includes('opened the example'),false);
 assert.equal((await (await read(guide,'derek')).json()).checkpoint.next_minimum_step,payload.next);
 const pause={taskId:task,clientMutationId:uuid(19),pause:true,actualStep:true,stepId:uuid(20),stepVersion:'2026-11-25T12:00:00Z',preparation:false,completed:'',next:'step example',location:'a private location'};
 assert.equal((await read('/api/control',null,{method:'POST',headers:{Authorization:'Bearer derek','Content-Type':'application/json'},body:JSON.stringify({action:'record_guide_step',...pause})})).status,403);
 assert.equal((await post('derek',{...pause,stepVersion:'older'})).status,409);
 assert.equal((await post('derek',{...pause,completed:'not allowed'})).status,422);
 assert.equal((await post('suki',pause)).status,409);
 assert.equal((await post('derek',pause)).status,201);assert.equal((await post('derek',pause)).status,200);
 assert.equal((await post('derek',{...pause,location:'new position'})).status,409);
 assert.equal(rows.length,2);assert.equal(rows[1].completed_summary,null);assert.equal(rows[1].current_position,'開工導航：已暫停原定步驟 #12\na private location');
 assert.equal(audit.length,2);assert.equal(JSON.stringify(audit).includes('private location'),false);
 const latest=rows.at(-1);latest.last_worked_at='2020-11-25T00:00:00Z';
 const launch=guide+'&launch=1';
 assert.equal((await (await read(launch,'derek')).json()).resumeCheckpointId,latest.id);
 latest.author_id=people.suki;assert.equal((await (await read(launch,'derek')).json()).resumeCheckpointId,null);latest.author_id=people.derek;
 latest.last_worked_at=new Date().toISOString();assert.equal((await (await read(launch,'derek')).json()).resumeCheckpointId,null);
 assert.equal((await read(launch,'suki')).status,404);
 assert.equal((await read('/api/calendar-brief')).status,401);assert.equal((await read('/api/calendar-brief?owner_id='+people.suki,'derek')).status,400);
 for(const actor of Object.keys(people)){const response=await read('/api/calendar-brief',actor);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);const b=await response.json();assert.equal(b.familyDates[0].title,actor+' school fixture');assert.equal(b.nextSchoolDate.title,actor+' next school');assert.equal(b.text.includes('school fixture')||b.text.includes('next school'),false);}
 const stop='/api/calendar-brief?view=work-stop';
 assert.equal((await read(stop)).status,401);assert.equal((await read(stop+'&owner_id=elsewhere','derek')).status,400);
 for(const actor of Object.keys(people)){const response=await read(stop,actor);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);const b=await response.json();assert.equal(b.panelOnly,true);assert.deepEqual(b.events.map(e=>e.title),[actor+' timed fixture']);assert.deepEqual(Object.keys(b.events[0]).sort(),['end','start','title']);assert.ok(!('familyDates' in b)&&!('days' in b)&&!('text' in b));}
 assert.deepEqual(familyReads,Object.values(people));assert.deepEqual(faults,[]);
 console.log('PASS actual guide/calendar handlers: auth, owner scope, retry idempotency, no draft/parent side effects, no private titles in audit or agent text, three isolated readers');
}finally{await new Promise(ok=>fixture.close(ok));}
