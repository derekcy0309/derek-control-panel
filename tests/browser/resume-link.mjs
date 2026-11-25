import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const origin = new URL(process.env.VERIFY_URL || "http://127.0.0.1:3219").origin;
assert.ok(new URL(origin).hostname === "127.0.0.1" || /^https:\/\/derek-control-panel(?:-[a-z0-9]+-derekcy0309-4881s-projects)?\.vercel\.app$/.test(origin));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const uid = i => "74000000-0000-4000-8000-"+String(i).padStart(12,"0");
const user=uid(1), taskId=uid(2), savedId=uid(3), day="2026-11-25";
const task={id:taskId,user_id:user,owner_id:user,scope:"home",area:"personal",source_type:"follow_up",title:"本人首項測試工作",status:"in_progress",risk:"low",priority_grade:3,requested_priority:3,next_action:"核對下一段文字",personal_tag_ids:[],created_at:day,updated_at:day};
const data={currentUser:{id:user,email:"owner@example.test",displayName:"測試帳戶"},settings:{theme:"light"},profile:{user_id:user,active:true},participants:[{user_id:user,display_name:"測試帳戶"}],
  tasks:[task],taskCatalog:[task],taskQueueCatalog:[task],task,taskTags:[],assignments:[],shares:[],taskNoticeRecipients:[],taskFollowers:[],taskDependencies:[],reminders:[],capacityCommitments:[],
  planning:[{user_id:user,resource_type:"task",resource_id:taskId,plan_role:"now",plan_source:"manual",planned_date:day,plan_position:1}],childTasks:[],taskSteps:[],handoffNotes:[],taskRecurrenceRules:[],activityLogs:[],parentTask:null};
const saved={id:savedId,task_id:taskId,author_id:user,state:"saved",last_worked_at:"2026-11-24T03:00:00Z",current_position:"第四段",next_minimum_step:"核對下一段文字",completed_summary:"已核對前三段",resource_links:[]};
try {
 for(const width of [360,1280]){
  const context=await browser.newContext({viewport:{width,height:840},serviceWorkers:"block",timezoneId:"Asia/Hong_Kong"});
  try{
   const page=await context.newPage(),writes=[],errors=[],guideReads=[],historyReads=[];
   let candidate=null, changed=false;
   page.setDefaultTimeout(18000);
   page.on("pageerror",e=>errors.push(e.message));
   await page.clock.setFixedTime(new Date(day+"T02:00:00Z"));
   await context.route("**/*",async route=>{
    const r=route.request(),u=new URL(r.url());
    if(u.origin!==origin)return route.abort();
    if(!["GET","HEAD"].includes(r.method())){if(u.pathname.startsWith("/api/"))writes.push(u.pathname);return route.abort();}
    if(!u.pathname.startsWith("/api/"))return route.continue();
    let body={};
    if(u.pathname==="/api/auth")body={user:{id:user}};
    else if(u.pathname==="/api/control"){
      const view=u.searchParams.get("view");
      if(view==="work_guide"){
        guideReads.push(u.searchParams.get("taskId"));body={checkpoint:saved,steps:[],openChildren:false,resumeCheckpointId:candidate};
      }else if(view==="task_checkpoints"){
        historyReads.push(u.searchParams.get("taskId"));const record=changed?{...saved,id:uid(5),author_id:uid(6)}:saved;
        body={latest:record,draft:null,history:[record]};
      }else if(view==="task_resources")body={resources:[]};
      else if(view==="assignment_alerts")body={assignments:[],currentUserId:user};
      else body=data;
    }else if(u.pathname==="/api/calendar-brief")body={days:[],sources:[],familyDates:[],generatedAt:day+"T02:00:00Z"};
    else if(u.pathname==="/api/information")body={prefs:{},routes:[]};
    else if(u.pathname==="/api/start-links")body={links:[]};
    await route.fulfill({json:body});
   });
   const card=page.locator("#dayline-start"),link=card.getByRole("link",{name:"查看進度：接續上次進度"});
   await page.goto(origin+"/#dayline-start");
   await card.getByText("從上次進度繼續",{exact:true}).waitFor();
   assert.equal(await link.count(),0);
   const heightBefore=(await card.boundingBox()).height;
   candidate=savedId;await page.reload();
   await link.waitFor();
   assert.deepEqual(historyReads,[],"the dashboard never loads full checkpoint history");
   assert.deepEqual([...new Set(guideReads)],[taskId],"no backlog scan");
   assert.ok((await card.boundingBox()).height <= heightBefore+1, "the optional resume link must not push down the agenda");
   assert.equal(await link.getAttribute("href"),"/tasks/"+taskId+"#task-progress-"+savedId);
   await link.click();
   const target=page.locator("#task-progress-"+savedId);
   await target.getByText("接續上次進度",{exact:true}).waitFor().catch(async error=>{throw new Error("Checkpoint did not open: "+JSON.stringify({url:page.url(),errors,historyReads,headings:await page.getByRole("heading").allTextContents(),alerts:await page.getByRole("alert").allTextContents()}),{cause:error});});
   await target.getByText("已核對前三段",{exact:true}).waitFor();
   assert.equal(await target.evaluate(el=>el===document.activeElement),true);
   assert.deepEqual([...new Set(historyReads)],[taskId]);
   changed=true;await page.reload();
   await page.getByRole("status").getByText(/該紀錄並非目前可接續的最新進度/).waitFor();
   assert.equal(await target.count(),0);
   assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   console.log(`PASS ${width}px: first task unchanged, secondary link, private checkpoint target and stale fallback; no writes`);
  }finally{await context.close();}
 }
}finally{await browser.close();}
