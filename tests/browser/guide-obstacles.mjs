// Real browser controls and isolated fixtures; never contact a person, AI or production API.
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
const origin=new URL(process.env.VERIFY_URL||"http://127.0.0.1:3219").origin;
assert.ok(new URL(origin).hostname==="127.0.0.1"||/^https:\/\/derek-control-panel(?:-[a-z0-9]+-derekcy0309-4881s-projects)?\.vercel\.app$/.test(origin));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:"playwright");
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
try{
 for(const width of [390,1280]){
  const ctx=await browser.newContext({serviceWorkers:"block",viewport:{width,height:844},timezoneId:"Asia/Hong_Kong"});const page=await ctx.newPage();
  const now="2026-11-25T00:15:00.000Z",day="2026-11-25",userA="11111111-1111-4111-8111-111111111111",userB="21111111-1111-4111-8111-111111111111";let viewer=userA,first=0;
  const ids=["33333333-1111-4111-8111-111111111111","43333333-1111-4111-8111-111111111111"],titles=["私人測試 A","私人測試 B"],writes=[],errors=[];
  const posted="請提供本季最新的公開指引連結。";
  await page.clock.setFixedTime(new Date(now));await page.addInitScript(({reject})=>{
    window.fixtureCopied=[];Object.defineProperty(navigator,"clipboard",{value:{writeText:async v=>{if(reject)throw Error("denied");window.fixtureCopied.push(v);}}});
  },{reject:width===390});page.on("pageerror",e=>errors.push(e.message));
  await ctx.route("**/*",async route=>{
   const r=route.request(),u=new URL(r.url());if(u.origin!==origin)return route.abort();
   if(!u.pathname.startsWith("/api/"))return ["GET","HEAD"].includes(r.method())?route.continue():route.abort();
   if(r.method()!=="GET"){writes.push([r.method(),u.pathname]);return route.fulfill({status:405,json:{error:"No writes expected"}});}
   let json;
   if(u.pathname==="/api/auth")json={user:{id:viewer}};
   else if(u.pathname==="/api/calendar-brief")json={generatedAt:now,events:[],incomplete:false,panelOnly:true};
   else if(u.searchParams.get("view")==="work_guide")json={steps:[],openChildren:false,checkpoint:null};
   else{const tasks=ids.map((id,i)=>({id,title:titles[i],next_action:"先核對私人測試備註",owner_id:viewer,user_id:viewer,status:"not_started",scope:"home",area:"personal",requested_priority:3,personal_tag_ids:[]}));
    json={currentUser:{id:viewer,email:"synthetic@example.test",displayName:"測試"},profile:{active:true,user_id:viewer},settings:{theme:"light"},tasks,taskCatalog:tasks,taskQueueCatalog:tasks,
      planning:[{user_id:viewer,resource_type:"task",resource_id:ids[first],planned_date:day,plan_role:"now",plan_source:"manual",plan_position:1}],taskTags:[],assignments:[],shares:[],taskFollowers:[],taskDependencies:[],participants:[],capacityCommitments:[],reminders:[]};}
   return route.fulfill({status:200,json});
  });
  const guide=page.locator(".work-guide"),help=guide.locator("details").filter({has:page.getByText("我遇到困難",{exact:true})});
  const load=async()=>{await page.goto(origin+"/work-guide");await guide.getByRole("heading",{name:titles[first]}).waitFor();await help.locator("summary").click();};
  await load();await help.getByRole("button",{name:"步驟太大"}).click();await guide.getByRole("button",{name:"已準備好，返回目前步驟"}).waitFor();
  assert.equal(await help.getByRole("link",{name:"查看共同專注選項"}).getAttribute("href"),"/body-double");
  await help.getByRole("button",{name:"欠缺資料"}).click();const info=help.getByLabel("索取資料草稿");
  const template=await info.inputValue();assert.ok(!template.includes("私人測試"));await info.fill(posted);await help.getByRole("button",{name:"複製草稿"}).click();
  if(width===390){await help.getByText(/未能自動複製/).waitFor();assert.equal(await info.evaluate(el=>el.value.substring(el.selectionStart,el.selectionEnd)),posted);}
  else {await help.getByText("已複製草稿，尚未傳送。").waitFor();assert.deepEqual(await page.evaluate(()=>window.fixtureCopied),[posted]);}
  await help.getByRole("button",{name:"需要他人決定"}).click();const decision=help.getByLabel("請對方決定的草稿");assert.ok(!(await decision.inputValue()).includes(posted));await decision.fill("");assert.equal(await help.getByRole("button",{name:"複製草稿"}).isDisabled(),true);
  first=1;await load();await help.getByRole("button",{name:"欠缺資料"}).click();assert.equal(await info.inputValue(),template);
  first=0;viewer=userB;await load();await help.getByRole("button",{name:"欠缺資料"}).click();assert.equal(await info.inputValue(),template);
  viewer=userA;await load();await help.getByRole("button",{name:"欠缺資料"}).click();assert.equal(await info.inputValue(),posted);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log("PASS "+width+"px: 3 reasons; clipboard "+(width===390?"selection fallback":"success")+"; no posts; scoped editable drafts across tasks and accounts.");
  await ctx.close();
 }
}finally{await browser.close();}
