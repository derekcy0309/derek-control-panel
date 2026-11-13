// Exercise the REAL Next.js backup API against a local Supabase HTTP fixture.
// Complements SQL integration and browser UI fixtures; no production connection.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
const base='http://127.0.0.1:3144';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const uuid=n=>`99999999-9999-4999-8999-${String(n).padStart(12,'0')}`;
let actor=ids[0],tagFailure=false,tooMany=false,audits=0,rpcs=0,linkPages=0;
const tags=()=>[{id:uuid(1),user_id:actor,name:'學習',deleted_at:null},{id:uuid(2),user_id:actor,name:'Wecare',deleted_at:null},{id:uuid(3),user_id:actor,name:'已移除',deleted_at:'2026-11-01T00:00:00Z'}];
const links=()=>Array.from({length:tooMany?10001:1205},(_,i)=>({user_id:actor,task_id:uuid(100+i),tag_id:uuid(i%2+1)}));
const backend=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');let status=200,result=[];
  try {
    if(url.pathname==='/auth/v1/user') {
      assert.equal(req.headers.authorization,'Bearer fixture-access');
      result={id:actor,email:'fixture@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-11-14T00:00:00Z'};
    } else if(url.pathname==='/rest/v1/rpc/restore_backup_v3') {
      rpcs++;let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);assert.equal(body.p_backup.ownerId,actor);assert.equal(body.p_backup.data.taskTagAssignments.length,1205);
      result={personalTaskTags:0,taskTagAssignments:0,taskTagPreferences:0};
    } else {
      const table=url.pathname.split('/').at(-1);
      if(table==='backup_restore_audit_logs'&&req.method==='POST'){audits++;result=null;}
      else {
        if(['personal_task_tags','task_tag_assignments','task_tag_preferences'].includes(table)) assert.equal(url.searchParams.get('user_id'),`eq.${actor}`);
        if(table==='personal_task_tags'){if(tagFailure){status=503;result={message:'fixture failure'};}else result=tags();}
        else if(table==='task_tag_assignments'){linkPages++;result=links();}
        else if(table==='task_tag_preferences') result=[{user_id:actor,initialized_at:'2026-11-13T00:00:00Z'}];
        else if(table==='tasks') {
          const idFilter=url.searchParams.get('id');
          result=idFilter?links().filter(link=>idFilter.includes(link.task_id)).map(link=>({id:link.task_id,deleted_at:null})):
            links().slice(0,2).map((link,i)=>({id:link.task_id,owner_id:actor,title:`Fixture ${i}`,deleted_at:null,archived_at:null}));
        } else if(table==='user_profiles'||table==='user_settings'||table==='notification_preferences') result=null;
        const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000);
        if(Array.isArray(result)) result=result.slice(offset,offset+limit);
      }
    }
  } catch(error) {status=500;result={message:String(error)};}
  res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
});
await new Promise(resolve=>backend.listen(4172,'127.0.0.1',resolve));
let logs='';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','-p','3144'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:4172',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-anon-key',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
server.stdout.on('data',chunk=>{logs+=chunk;});server.stderr.on('data',chunk=>{logs+=chunk;});
const request=(path,init={})=>fetch(base+path,{...init,headers:{Cookie:'dcp_access=fixture-access',...init.headers}});
const post=body=>request('/api/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
try {
  for(let i=0;i<100;i++) {
    if(server.exitCode!==null) throw new Error(logs.slice(-2500));
    try {if((await fetch(`${base}/api/backup`)).status===401) break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,400));
  }
  for(const [i,role] of ['Derek','Suki','Amigo'].entries()) {
    actor=ids[i];linkPages=0;
    const response=await request('/api/backup?format=json');assert.equal(response.status,200);
    assert.match(response.headers.get('cache-control'),/private, no-store/);
    assert.match(response.headers.get('content-disposition'),/attachment/);
    const value=await response.json();assert.equal(value.ownerId,actor);
    assert.equal(value.data.personalTaskTags.length,3);assert.equal(value.data.taskTagAssignments.length,1205);assert.equal(value.data.taskTagPreferences.length,1);
    assert.ok(value.data.personalTaskTags.every(tag=>tag.user_id===actor));assert.ok(value.data.taskTagAssignments.every(link=>link.user_id===actor));assert.ok(linkPages>=2);
    const csv=await request('/api/backup?format=csv&kind=tasks');assert.equal(csv.status,200);const csvBody=await csv.text();assert.match(csvBody,/Tags/);assert.match(csvBody,/學習/);assert.doesNotMatch(csvBody,/已移除/);
    const preview=await post({action:'preview',backup:value});assert.equal(preview.status,200);const summary=await preview.json();
    assert.equal(summary.recordCounts.taskTagAssignments,1205);assert.ok(summary.conflicts.some(conflict=>conflict.category==='personalTaskTags'&&conflict.count===3));
    const before=rpcs;assert.equal((await post({action:'restore',backup:value})).status,422);assert.equal(rpcs,before);
    assert.equal((await post({action:'restore',backup:value,confirmation:'RESTORE',acknowledged:true})).status,200);assert.equal(rpcs,before+1);
    const foreign=structuredClone(value);foreign.data.personalTaskTags[0].user_id=ids[(i+1)%3];
    assert.equal((await post({action:'preview',backup:foreign})).status,422);assert.equal(rpcs,before+1);
    const auditBefore=audits;tagFailure=true;assert.equal((await request('/api/backup')).status,500);assert.equal(audits,auditBefore);tagFailure=false;
    console.log(`PASS real backup API ${role}: 1205 paginated links, JSON/CSV, preview, explicit confirmation, ownership and failed-export handling`);
  }
  tooMany=true;const oversized=await request('/api/backup');assert.equal(oversized.status,422);assert.match((await oversized.json()).error,/超出安全上限/);
  console.log('PASS real backup API: oversized tag collection is rejected, never silently truncated');
} catch(error) {throw new Error(`${error.message}\n${logs.slice(-2500)}`,{cause:error});}
finally {server.kill();await new Promise(resolve=>backend.close(resolve));}
