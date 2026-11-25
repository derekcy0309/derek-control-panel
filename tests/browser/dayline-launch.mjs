// Uses synthetic responses only. A hosted run requires an explicitly verified Dayline origin.
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
const origin=new URL(process.env.VERIFY_URL||"http://127.0.0.1:3219").origin;
assert.ok(new URL(origin).hostname==="127.0.0.1"||/^https:\/\/derek-control-panel(?:-[a-z0-9]+-derekcy0309-4881s-projects)?\.vercel\.app$/.test(origin));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:"playwright");
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
const user="11111111-1111-4111-8111-111111111111", id="88888888-1111-4111-8111-111111111111";
const date="2026-11-25", task={id,title:"改測試單張",owner_id:user,user_id:user,status:"not_started",source_type:"follow_up",scope:"home",area:"personal",priority_grade:3,next_action:"圈出一句要改嘅文字",due_date:null,requested_priority:3,personal_tag_ids:[],created_at:date,updated_at:date};
const dashboard={currentUser:{id:user,email:"start@example.test",displayName:"測試"},profile:{active:true,user_id:user},settings:{theme:"light"},tasks:[task],taskQueueCatalog:[task],taskCatalog:[task],taskTags:[],participants:[{user_id:user,display_name:"測試"}],taskFollowers:[],planning:[{user_id:user,resource_type:"task",resource_id:id,planned_date:date,plan_role:"now",plan_source:"manual",plan_position:1}],assignments:[],shares:[],taskNoticeRecipients:[],taskDependencies:[],reminders:[],capacityCommitments:[]};
try {
 for(const width of [390,1280]){
  const context=await browser.newContext({serviceWorkers:"block",viewport:{width,height:840},timezoneId:"Asia/Hong_Kong"});
  const page=await context.newPage(),writes=[],external=[],errors=[];
  let launch=null,unavailable=false;
  const remote="https://resource.example.test/first-draft";
  page.on("pageerror",err=>errors.push(err.message));
  await page.clock.setFixedTime(new Date(date+"T02:00:00Z"));
  await context.route("**/*",async route=>{
   const r=route.request(),u=new URL(r.url());
   if(u.origin!==origin){external.push(u.href);return route.fulfill({status:200,body:"Synthetic resource"});}
   if(!u.pathname.startsWith("/api/"))return ["GET","HEAD"].includes(r.method())?route.continue():route.abort();
   let data={},status=200;
   if(r.method()!=="GET"){
    const input=r.postDataJSON();writes.push(input.action);
    if(input.action==="open_task_storage_resource"){assert.equal(input.id,id);status=403;data={error:"測試權限"};}
    else status=422;
   }else if(u.pathname==="/api/auth") data={user:{id:user}};
   else if(u.pathname==="/api/control"){
    const v=u.searchParams.get("view");
    if(v==="work_guide"){assert.equal(u.searchParams.get("launch"),"1");assert.equal(u.searchParams.get("taskId"),id);data={steps:[],checkpoint:null,openChildren:false,launch,launchUnavailable:unavailable};}
    else if(v==="assignment_alerts")data={assignments:[],currentUserId:user};
    else data=dashboard;
   }else if(u.pathname==="/api/information")data={prefs:{},routes:[]};
   else if(u.pathname==="/api/calendar-brief")data={events:[],deadlines:[],school:[],warnings:[],generatedAt:date+"T02:00:00Z"};
   else if(u.pathname==="/api/start-links")data={links:[]};
   await route.fulfill({status,json:data});
  });
  const card=page.locator("#dayline-start");
  async function visit(){const url=origin+"/#dayline-start";if(page.url()===url)await page.reload();else await page.goto(url);await card.getByRole("heading",{name:task.title}).waitFor();}
  launch={kind:"web",label:"測試草稿",href:remote};
  await visit();
  const link=card.getByRole("link",{name:"打開測試草稿"});
  await link.waitFor();assert.equal(await link.getAttribute("href"),remote);
  assert.deepEqual(external.filter(url=>url===remote),[],"daily link does not launch an external resource");
  const popup=page.waitForEvent("popup");await link.click();await (await popup).close();
  launch=null;unavailable=true;await visit();
  await card.getByText("部分資源暫時未能讀取。",{exact:false}).waitFor();
  await card.getByRole("button",{name:"再細一步"}).click();
  await card.getByText("先搵到份文件，打開就得。",{exact:true}).waitFor();
  assert.equal(page.url(),origin+"/#dayline-start");assert.deepEqual(writes,[]);
  launch={kind:"file",label:"私人檔案",resourceId:id};unavailable=false;await visit();
  const file=card.getByRole("button",{name:"打開私人檔案"});await file.waitFor();
  assert.deepEqual(writes,[]);await file.click();await card.getByRole("alert").waitFor();
  assert.deepEqual(writes,["open_task_storage_resource"]);assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  console.log("PASS "+width+"px: protected deep-link, click-only resource, inline fallback, storage denial, no task writes.");
  await context.close();
 }
}finally{await browser.close();}
