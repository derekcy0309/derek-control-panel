// Local-only synthetic accounts; a lost acknowledgement must not duplicate the memo or reload the current task.
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
const origin=new URL(process.env.VERIFY_URL||"http://127.0.0.1:3219").origin;
assert.ok(["localhost","127.0.0.1"].includes(new URL(origin).hostname));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:"playwright");
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined});
const user="81230000-0000-4000-8000-000000000001",id="81230000-0000-4000-8000-000000000002";
const day="2026-11-25",now=day+"T01:00:00Z";
const task={id,title:"準備開會",user_id:user,owner_id:user,area:"personal",scope:"home",source_type:"follow_up",status:"not_started",requested_priority:1,created_at:now,updated_at:now,personal_tag_ids:[]};
const data={currentUser:{id:user,displayName:"測試"},profile:{user_id:user,active:true,display_name:"測試"},settings:{theme:"light",focus_minutes:25},participants:[],tasks:[task],taskCatalog:[task],taskQueueCatalog:[task],taskTags:[],planning:[{user_id:user,resource_id:id,resource_type:"task",planned_date:day,plan_role:"now",plan_source:"manual",plan_position:1}],taskFollowers:[],assignments:[],taskNoticeRecipients:[],taskDependencies:[],shares:[],taskSteps:[],capacity:null,capacityCommitments:[],reminders:[],notificationPreferences:null,calendarConnections:[]};
try{
 for(const width of [390,1280]){
  const ctx=await browser.newContext({viewport:{width,height:850},timezoneId:"Asia/Hong_Kong",locale:"zh-HK",serviceWorkers:"block"}),page=await ctx.newPage();
  page.setDefaultTimeout(20000);await page.clock.setFixedTime(new Date(now));
  const seen=[],violations=[],errors=[],loads=[],sample="私人備忘測試：週末取回文件。";
  page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",async r=>{
    const req=r.request(),u=new URL(req.url());
    if(u.origin!==origin)return r.abort();
    if(req.isNavigationRequest()&&req.frame()===page.mainFrame())loads.push("document");
    if(u.pathname==="/api/quick-capture"){
      const form=await new Response(req.postDataBuffer(),{headers:{"content-type":req.headers()["content-type"]}}).formData();
      seen.push({method:req.method(),uid:req.headers()["x-dayline-account"],data:Object.fromEntries(form)});
      if(seen.length===1)return r.abort("connectionreset");
      return r.fulfill({status:201,json:{item:{id:"test-receipt",owner_id:user,item_type:"inbox",title:sample},uploaded:false}});
    }
    if(req.method()!=="GET"&&u.pathname.startsWith("/api/")){violations.push([req.method(),u.pathname]);return r.abort();}
    if(!u.pathname.startsWith("/api/"))return r.continue();
    const view=u.searchParams.get("view");
    if(view==="today"||view==="work_guide")loads.push(view);
    const json=u.pathname==="/api/auth"?{user:{id:user}}:u.pathname==="/api/control"?
      (view==="work_guide"?{steps:[],checkpoint:null,openChildren:false}:view==="assignment_alerts"?{assignments:[],currentUserId:user}:data):
      u.pathname==="/api/calendar-brief"?{from:day,untilExclusive:"2026-11-28",generatedAt:now,days:[],sources:[],familyDates:[]}:
      u.pathname==="/api/start-links"?{ownerId:user,links:[],shortcuts:[]}:u.pathname==="/api/information"?{prefs:{traffic:false,news:false,journals:false},routes:[]}:{};
    return r.fulfill({json});
  });
  try{
    await page.goto(origin+"/work-guide");const heading=page.getByRole("heading",{name:task.title,exact:true});await heading.waitFor();
    const guide=page.locator("article").filter({has:heading}),action=guide.locator("p.text-xl").first();
    const step=await action.textContent(),before=[...loads];
    await page.getByText("暫記備忘",{exact:true}).click();const field=page.getByRole("textbox",{name:"稍後處理的事項"});
    await field.fill(sample);await page.getByRole("button",{name:"存入收集箱"}).click();
    const retry=page.getByRole("button",{name:"重試儲存"});await retry.waitFor();
    assert.equal(await field.inputValue(),sample);
    const notPersisted=()=>page.evaluate(s=>![localStorage,sessionStorage].some(st=>Object.values(st).some(v=>String(v).includes(s))),sample);
    assert.ok(await notPersisted());assert.equal(seen.length,1);
    await retry.click();await page.getByText("已存入你的收集箱。你可以繼續目前的步驟。").waitFor();
    assert.equal(await field.inputValue(),"");assert.ok(await notPersisted());
    assert.equal(seen.length,2);assert.deepEqual(seen[0],seen[1]);
    const m=seen[0];assert.equal(m.method,"POST");assert.equal(m.uid,user);assert.deepEqual(Object.keys(m.data).sort(),["area","clientCaptureId","source","title"]);
    assert.match(m.data.clientCaptureId,/^[a-f\d-]{36}$/i);assert.equal(m.data.title,sample);assert.equal(m.data.area,"personal");assert.equal(m.data.source,"text");
    assert.equal(await action.textContent(),step);assert.equal(new URL(page.url()).pathname,"/work-guide");assert.deepEqual(loads,before);
    assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
    console.log("PASS guide memo "+width+"px: private inline capture, uncertain response keeps input, reuse request key, no browser storage, guide re-fetch, task mutation or navigation.");
  }finally{await ctx.close();}
 }
}finally{await browser.close();}
