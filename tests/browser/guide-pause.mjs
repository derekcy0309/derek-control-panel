// Authenticated browser fixture. No access to a real account, calendar or database.
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
const origin=new URL(process.env.VERIFY_URL||"http://127.0.0.1:3219").origin;
assert.ok(new URL(origin).hostname==="127.0.0.1"||/^https:\/\/derek-control-panel(?:-[a-z0-9]+-derekcy0309-4881s-projects)?\.vercel\.app$/.test(origin));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:"playwright");
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
try {
 for(const width of [390,1280]){
  const ctx=await browser.newContext({viewport:{width,height:844},serviceWorkers:"block",timezoneId:"Asia/Hong_Kong"});
  const page=await ctx.newPage();page.setDefaultTimeout(15_000);
  const now="2026-11-25T04:00:00.000Z",today="2026-11-25",user="11111111-1111-4111-8111-111111111111",writes=[],errors=[];
  const recurring=width===390;
  const first={id:"22222222-1111-4111-8111-111111111111",user_id:user,owner_id:user,title:"按人手次序先處理",status:"not_started",requested_priority:5,scope:"home",area:"personal",recurrence_rule_id:recurring?"rule":null,personal_tag_ids:[]};
  const second={...first,id:"32222222-1111-4111-8111-111111111111",title:"稍後才處理",requested_priority:1,recurrence_rule_id:null};
  const planning=[first,second].map((t,i)=>({user_id:user,resource_type:"task",resource_id:t.id,planned_date:today,plan_role:i?"later":"now",plan_source:"manual",plan_position:i+1}));
  const steps=[{id:"42222222-1111-4111-8111-111111111111",title:"核對工作表",status:"todo",sort_order:3,updated_at:now}];
  const data={currentUser:{id:user,email:"fixture@example.test",displayName:"測試用戶"},profile:{active:true,user_id:user},settings:{theme:"light"},planning,tasks:[first,second],taskCatalog:[first,second],taskQueueCatalog:[first,second],taskTags:[],participants:[],taskFollowers:[],assignments:[],shares:[],taskNoticeRecipients:[],taskDependencies:[],reminders:[],capacityCommitments:[]};
  let checkpoint=null,showIncomplete=true,retryPause=true;
  await page.clock.setFixedTime(new Date(now));page.on("pageerror",e=>errors.push(e.message));
  await ctx.route("**/*",async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==origin)return route.abort();
   if(!url.pathname.startsWith("/api/"))return ["GET","HEAD"].includes(req.method())?route.continue():route.abort();
   let json={},status=200;
   if(url.pathname==="/api/auth")json={user:{id:user}};
   else if(url.pathname==="/api/calendar-brief")json={generatedAt:now,events:[],incomplete:showIncomplete,panelOnly:true};
   else if(req.method()==="GET")json=url.searchParams.get("view")==="work_guide"?{steps:url.searchParams.get("taskId")===first.id?steps:[],checkpoint,openChildren:false}:data;
   else {
    const body=req.postDataJSON();writes.push(body);
    if(body.action==="record_guide_step"){
     assert.equal(body.pause,true);assert.equal(body.actualStep,true);assert.equal(body.completed,"");assert.equal(body.next,steps[0].title);
     if(retryPause){retryPause=false;status=503;json={error:"未能儲存測試位置，請重試。"};}
     else{assert.equal(body.stepId,steps[0].id);assert.equal(body.stepVersion,now);checkpoint={current_position:"開工導航：已暫停原定步驟 #3"+(body.location?"\n"+body.location:""),next_minimum_step:body.next,completed_summary:null};json={checkpoint};}
    }else if(body.action==="update_task_step"){assert.equal(body.id,steps[0].id);assert.equal(body.expectedUpdatedAt,now);Object.assign(steps[0],{status:"done",updated_at:"2026-11-25T04:02:00Z"});json={step:steps[0]};}
    else if(body.action==="update_task"){assert.equal(body.id,first.id);assert.deepEqual(body.changes,{status:"done"});first.status="done";json={task:first};}
    else throw Error("Unexpected write: "+body.action);
   }
   return route.fulfill({status,json});
  });
  await page.goto(origin+"/work-guide");const g=page.locator(".work-guide"),button=name=>g.getByRole("button",{name,exact:true});
  await g.getByText("核對工作表",{exact:true}).waitFor();
  await g.getByText(/日曆資料不完整或未有更新/).waitFor();showIncomplete=false;await button("重新讀取日曆").click();await g.getByText(/今日暫無其他已確認時間的安排/).waitFor();
  assert.equal(writes.length,0);
  if(width===390){await g.getByText("補充暫停位置（選填）").click();await g.getByLabel("目前停在哪裏？").fill("第 5 列");}
  await button("暫停並儲存位置").click();await g.getByRole("alert").waitFor();
  assert.equal(await button("從這一步繼續").count(),0);assert.equal(steps[0].status,"todo");
  await button("暫停並儲存位置").click();await button("從這一步繼續").waitFor();assert.equal(writes[0].clientMutationId,writes[1].clientMutationId);
  await page.reload();await button("從這一步繼續").waitFor();
  await g.getByRole("heading",{name:first.title}).waitFor();if(width===390)await g.getByText("上次停在：第 5 列").waitFor();
  await button("從這一步繼續").click();assert.equal(writes.length,2);await button("完成這一步").click();
  const label=recurring?"確認完成本期（保留恆常任務）":"確認完成整項任務";
  await button(label).waitFor();assert.equal(first.status,"not_started");assert.equal(steps[0].status,"done");assert.equal(writes.length,3);
  assert.equal(await button("從這一步繼續").count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await button(label).click();await g.getByRole("heading",{name:second.title}).waitFor();assert.equal(first.status,"done");assert.equal(writes.length,4);assert.deepEqual(errors,[]);
  console.log("PASS "+width+"px: actual checklist pause/retry/reload; manual order, stale calendar, step-only and separate "+(recurring?"occurrence":"whole-task")+" closure.");
  await ctx.close();
 }
}finally{await browser.close();}
