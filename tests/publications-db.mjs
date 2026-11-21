// Disposable PostgreSQL (WASM), no live credentials. Private authorised seed envelopes enter via stdin only.
import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {preparePublication} from "../lib/server/publication-source.ts";
const {PGlite}=await import(process.env.DAYLINE_PGLITE?pathToFileURL(resolve(process.env.DAYLINE_PGLITE)).href:"@electric-sql/pglite");
const db=new PGlite();
const A="10000000-0000-4000-8000-000000000001",B="10000000-0000-4000-8000-000000000002",C="10000000-0000-4000-8000-000000000003";
async function run(sql,params=[]){return(await db.query(sql,params)).rows;}
const value=async(sql,p=[])=>(await run(sql,p))[0]?.v;
const actor=async id=>{await db.exec("reset role");if(id){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec("set role authenticated");}};
const count=()=>value("select public.dayline_unread() v");
const lookup=(q="",mode="all",category="all")=>run("select x v from public.dayline_issues($1,'2026-11',$2,$3,0) x",[category,q,mode]).then(x=>x.map(y=>y.v));
const ingest=(doc,prev=null)=>value("select dayline_reading.ingest($1,$2,$3) v",[A,JSON.stringify(doc),prev]);
const raw={title:"QA 期刊",published:"2026-11-21",from:"2026-11-08",until:"2026-11-21",lead:"測試",format:"markdown",original:"# QA\n\n舊刊 BRCA 摘要 [來源](https://example.org/official)",sourceKind:"codex-scheduled",sourceRef:"qa"};
let inputs=["home","ngo","chronic","weekly","us"].map(series=>({...raw,series,sourceKind:series==="us"?"codex-trial":raw.sourceKind,title:series.toUpperCase()+" QA 期刊"}));
if(process.argv.includes("--private-stdin")){
 if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.setEncoding("utf8");process.stdout.write("DAYLINE_PRIVATE_INPUT_READY\n");
 const line=await new Promise((ok,fail)=>{let s="";const read=chunk=>{s+=chunk;if(s.length>1200000){fail(Error("input too large"));return;}if(/[\r\n]/.test(s)){process.stdin.off("data",read);process.stdin.pause();ok(s.split(/[\r\n]/)[0]);}};process.stdin.on("data",read);});inputs=JSON.parse(Buffer.from(line,"base64").toString("utf8"));
}
const issues=inputs.map(preparePublication);
try{
 await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create table public.user_profiles(user_id uuid primary key,active boolean not null);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant select on public.user_profiles to authenticated;");
 for(const id of [A,B,C]){await db.query("insert into auth.users values($1)",[id]);await db.query("insert into public.user_profiles values($1,$2)",[id,id!==C]);}
 await db.exec(await readFile(new URL("../supabase/migrations/20261121112726_dayline_publication_library.sql",import.meta.url),"utf8"));
 for(const d of issues)assert.equal(await ingest(d),"created");
 const migDir=new URL("../supabase/migrations/",import.meta.url);const trialMigrations=(await readdir(migDir)).filter(f=>f.endsWith("_distinguish_published_trial.sql"));assert.equal(trialMigrations.length,1);
 const oldTrial=await value("select id v from dayline_reading.editions where series='us'");
 await db.exec(await readFile(new URL(trialMigrations[0],migDir),"utf8"));
 const roadMigs=(await readdir(migDir)).filter(f=>f.endsWith("_home_road_presets.sql"));assert.equal(roadMigs.length,1);await db.exec(await readFile(new URL(roadMigs[0],migDir),"utf8"));
 await actor(A);await run("select public.dayline_set_routes($1::text[])",[["tm-in","SJ5:TWTM"]]);await assert.rejects(run("select public.dayline_set_routes($1::text[])",[["cht","cht"]]));
 assert.deepEqual(await value("select road_presets v from public.dayline_info_choices where user_id=$1",[A]),["tm-in","SJ5:TWTM"]);await actor(B);assert.equal((await run("select * from public.dayline_info_choices where user_id=$1",[A])).length,0);
 await actor();await db.exec("set role anon");await assert.rejects(run("select public.dayline_set_routes('{}'::text[])"));await actor();
 assert.equal(await value("select id v from dayline_reading.editions where series='us' and is_trial"),oldTrial);
 if(process.argv.includes("--browser")){const {verifyJournalUI}=await import("./browser/publications-flow.mjs");await verifyJournalUI(db,A,B);}
 await actor(A);assert.equal(await count(),0);await run("select public.dayline_set_info('journals',true)");assert.equal(await count(),5);
 await run("insert into public.dayline_web_links(id,owner_id,shelf,title,url) values($1,$1,'site','私用','https://example.test')",[A]);await actor(B);assert.equal((await run("select * from public.dayline_web_links")).length,0);assert.equal((await run("update public.dayline_web_links set title='別人' where id=$1 returning id",[A])).length,0);await actor(A);
 const all=await lookup();assert.equal(all.length,5);assert.equal((await lookup("","all","medical")).length,4);assert.equal((await lookup("","all","us")).length,1);
 const hits=await lookup("brca");assert.ok(hits.some(x=>x.series==="ngo"));const hit=hits.find(x=>x.series==="ngo");assert.ok(Number.isInteger(hit.anchor));assert.match(hit.snippet,/brca/i);
 const detail=await value("select public.dayline_issue($1) v",[hit.id]);assert.match(detail.blocks[hit.anchor].text,/brca/i);assert.equal(await count(),5);
 await run("select public.dayline_issue_state($1,'save',true,null)",[hit.id]);assert.equal(await count(),5);
 await assert.rejects(run("select public.dayline_issue_state($1,'read',null,'bad')",[hit.id]));assert.equal(await count(),5);
 await run("select public.dayline_issue_state($1,'read',null,$2)",[hit.id,detail.revision]);assert.equal(await count(),4);assert.equal((await lookup("","saved")).length,1);
 await actor();for(const d of issues)assert.equal(await ingest(d),"unchanged");const old=issues.find(d=>d.series==="ngo");
 const modified=preparePublication({...inputs.find(d=>d.series==="ngo"),original:old.original+"\n "});await assert.rejects(ingest(modified));assert.equal(await ingest(modified,old.revision),"revised");assert.equal(await ingest(old),"unchanged");
 assert.equal(await value("select entry->>'original' v from dayline_reading.revisions where edition_id=$1 and version=1",[hit.id]),old.original);
 await actor(B);await run("select public.dayline_set_info('journals',true)");assert.equal(await count(),0);assert.equal(await value("select public.dayline_issue($1) v",[hit.id]),null);await assert.rejects(run("select public.dayline_issue_state($1,'save',true,null)",[hit.id]));
 // An explicit private grant of one issue can never carry the first reader's state.
 await actor();await run("insert into dayline_reading.readers values($1,$2)",[hit.id,B]);await actor(B);assert.equal(await count(),1);assert.equal((await lookup("","saved")).length,0);
 await actor(A);assert.equal(await count(),4);assert.equal((await lookup("","saved")).length,1);await run("select public.dayline_issue_state($1,'save',false,null)",[hit.id]);assert.equal(await count(),4);
 const proof="dlpub_"+"ab".repeat(32),hash=createHash("sha256").update(proof).digest("hex");
 await run("select public.dayline_publisher_key('us',$1)",[hash]);const payload=preparePublication({...raw,series:"us",published:"2026-11-22"});
 await actor();await db.exec("set role anon");const deliver=(p,d,outcome="issue")=>value("select public.dayline_deliver($1,$2,null,$3) v",[p,d&&JSON.stringify(d),outcome]);
 assert.equal(await deliver(proof,payload),"created");assert.equal(await deliver(proof,payload),"unchanged");await assert.rejects(deliver(proof,{...payload,series:"ngo"}));await assert.rejects(deliver("dlpub_"+"cd".repeat(32),payload));await assert.rejects(run("select public.dayline_issues('all','','','all',0)"));assert.equal(await deliver(proof,null,"no_issue"),"no_issue");
 await actor(A);assert.equal((await run("select x v from public.dayline_sync_status() x"))[0].v.result,"no_issue");await run("select public.dayline_publisher_key('us',null)");await actor();await db.exec("set role anon");await assert.rejects(deliver(proof,payload));
 await actor(C);assert.equal(await count(),0);await assert.rejects(run("select public.dayline_set_info('journals',true)"));
 await actor();const firstRegular=preparePublication({...raw,series:"us",original:"Regular edition, not the trial."});
 assert.equal(await ingest(firstRegular),"created");assert.equal(await ingest(firstRegular),"unchanged");assert.equal(await ingest(issues.find(x=>x.series==="us")),"unchanged");
 assert.equal(Number(await value("select count(*) v from dayline_reading.editions where series='us' and published='2026-11-21'")),2);
 assert.equal(await value("select id v from dayline_reading.editions where series='us' and is_trial"),oldTrial);
 console.log("PASS same-date trial and first real edition retained separately; replays create zero extras.");
 console.log("PASS isolated PostgreSQL: editions="+all.length+" medical=4 stock=1; BRCA matches="+hits.length+"; unread 5 → 5 after list/search/save → 4 after read; dedup, revision, owner/grantee isolation, disabled account and scoped push tested.");
 console.log("Source links by series: "+issues.map(i=>i.series+":"+i.blocks.reduce((n,b)=>n+b.links.length,0)).join(", "));
}finally{await db.close();}
