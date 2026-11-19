// In-memory PostgreSQL: exercise the existing checkpoint migrations themselves, not production users.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
if(!process.env.PGLITE_MODULE)throw new Error('Set PGLITE_MODULE to the local @electric-sql/pglite installation.');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const pg=new PGlite();
const id=n=>'cccccccc-cccc-4ccc-8ccc-'+String(n).padStart(12,'0');
const [derek,suki,amigo,task,guide,draft]=[1,2,3,4,5,6].map(id);
const sign=async actor=>{await pg.exec('reset role; set role authenticated');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);};
const save=(actor,reqId)=>pg.query("insert into task_checkpoints(id,task_id,author_id,state,current_position,next_minimum_step) values($1,$2,$3,'saved','guide','continue here') returning state",[reqId,task,actor]);
try{
 await pg.exec(`
  create role anon; create role authenticated; create schema auth; create schema private;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table auth.users(id uuid primary key);
  create table tasks(id uuid primary key, owner_id uuid, deleted_at timestamptz, archived_at timestamptz);
  create table assignments(resource_type text,resource_id uuid,assigned_to_id uuid,status text);
  create table share_records(resource_type text,resource_id uuid,shared_with_user_id uuid,permission text,revoked_at timestamptz,expires_at timestamptz);
  create function private.current_user_can_read(text,uuid) returns boolean language sql stable security definer as $$
   select exists(select from tasks where id=$2 and owner_id=auth.uid()) or exists(select from share_records where resource_type=$1 and resource_id=$2 and shared_with_user_id=auth.uid() and revoked_at is null)
  $$;
  grant usage on schema auth, private to authenticated;
 `);
 for(const actor of [derek,suki,amigo])await pg.query('insert into auth.users values($1)',[actor]);
 await pg.query('insert into tasks(id,owner_id) values($1,$2)',[task,derek]);
 await pg.query("insert into share_records(resource_type,resource_id,shared_with_user_id,permission) values('task',$1,$2,'view')",[task,suki]);
 for(const path of ['20260724120731_restart_checkpoints.sql','20260724121803_checkpoint_resource_privacy.sql'])await pg.exec(await readFile(new URL('../../supabase/migrations/'+path,import.meta.url),'utf8'));
 await sign(derek);
 await pg.query("insert into task_checkpoints(id,task_id,author_id,state,current_position) values($1,$2,$3,'draft','private focus note')",[draft,task,derek]);
 await pg.query("insert into task_checkpoint_resources(checkpoint_id,task_id,author_id,label,url,position) values($1,$2,$3,'private link','https://example.invalid/private',1)",[draft,task,derek]);
 assert.equal((await save(derek,guide)).rows[0].state,'saved');
 assert.deepEqual((await pg.query("select current_position from task_checkpoints where state='draft'")).rows,[{current_position:'private focus note'}]);
 assert.equal((await pg.query('select id from task_checkpoint_resources')).rows.length,1);
 await sign(suki);
 assert.deepEqual((await pg.query('select state,next_minimum_step from task_checkpoints')).rows,[{state:'saved',next_minimum_step:'continue here'}]);
 assert.equal((await pg.query('select id from task_checkpoint_resources')).rows.length,0);
 await assert.rejects(save(suki,id(7)),/CHECKPOINT_FORBIDDEN|row-level security/);
 await sign(amigo);
 assert.equal((await pg.query('select id from task_checkpoints')).rows.length,0);
 await pg.exec('reset role');await pg.query("update share_records set permission='edit' where shared_with_user_id=$1",[suki]);await sign(suki);
 assert.equal((await save(suki,id(8))).rows.length,1);
 console.log('PASS PostgreSQL checkpoint RLS: owner append preserves Focus draft and private links; viewer reads saved text only; outsider isolated; explicit editor can contribute.');
}finally{await pg.close();}
