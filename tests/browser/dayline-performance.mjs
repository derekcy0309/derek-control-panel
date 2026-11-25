import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const origin = new URL(process.env.VERIFY_URL || "http://127.0.0.1:3142").origin;
assert.equal(new URL(origin).hostname, "127.0.0.1", "Use only local Next, never a real account");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, headless: true });
const user = "71111111-1111-4111-8111-111111111111", taskId = "71111111-1111-4111-8111-111111111112";
const day = "2026-11-24", now = new Date(`${day}T09:00:00+08:00`);
const task = { id:taskId,user_id:user,owner_id:user,created_by_id:user,title:"假資料：先做呢件",next_action:"開文件",scope:"home",area:"personal",status:"not_started",due_date:day,requested_priority:1,personal_tag_ids:[],updated_at:now.toISOString() };
const identity = { id:user,displayName:"本機測試" };
const payload = { currentUser:identity,profile:{user_id:user,active:true,workspace_role:"derek"},settings:{theme:"light"},tasks:[task],taskQueueCatalog:[task],taskCatalog:[task],taskTags:[],participants:[],taskFollowers:[],planning:[{user_id:user,resource_type:"task",resource_id:task.id,planned_date:day,plan_role:"now",plan_source:"manual",plan_position:1}],operatingItems:[],assignments:[],shares:[],taskNoticeRecipients:[],taskDependencies:[],reminders:[],capacityCommitments:[],notificationPreferences:null };

async function run(path, holds, verify, failFocus = false) {
  const context = await browser.newContext({ viewport:{width:390,height:844},timezoneId:"Asia/Hong_Kong",locale:"zh-HK",serviceWorkers:"block" });
  const calls = [];
  const gates = new Map(holds.map(key=>{let open;const wait=new Promise(resolve=>{open=resolve;});return [key,{wait,open}];}));
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(now);
    await page.route("**/*", async route=>{
      const request = route.request(), url = new URL(request.url());
      if(url.origin!==origin || request.method()!=="GET") {await route.abort(); return;}
      if(!url.pathname.startsWith("/api/")) {await route.continue(); return;}
      const view=url.searchParams.get("view"), name=view?`${url.pathname}?view=${view}`:url.pathname;
      calls.push(name);
      if(gates.has(name))await gates.get(name).wait;
      let body;
      if(url.pathname==="/api/auth")body={user:{id:user}};
      else if(view==="shell")body={currentUser:identity,profile:{active:true,is_admin:false,must_change_password:false},settings:{theme:"light"}};
      else if(view==="today_focus"){
        if(failFocus) { await route.fulfill({status:503,json:{error:"模擬首屏 API 暫時失敗"}});return; }
        body={...payload,taskQueueCatalog:[],taskCatalog:[]};
      }
      else if(view==="today")body=payload;
      else if(view==="calendar")body={month:url.searchParams.get("month"),currentUser:identity,tasks:[task],operatingItems:[]};
      else if(view==="assignment_alerts")body={assignments:[],currentUserId:user};
      else if(view==="work_guide")body={steps:[],checkpoint:null,openChildren:false};
      else if(url.pathname==="/api/apple-calendar-month")body={month:"2026-11",from:"2026-10-26",until:"2026-12-07",events:[],source:{state:"not_connected",lastSync:null},truncated:false};
      else if(url.pathname==="/api/calendar-brief")body={generatedAt:now.toISOString(),from:day,untilExclusive:"2026-11-27",days:[],familyDates:[],sources:[],warnings:[],text:"假資料"};
      else if(url.pathname==="/api/information")body={prefs:{journals:false,news:false,traffic:false}};
      else body={links:[],shortcuts:[],warnings:[],forecast:[]};
      await route.fulfill({json:body});
    });
    await page.goto(origin+path);
    await verify(page,calls,key=>gates.get(key).open());
    assert.equal(calls.filter(call=>call==="/api/auth").length,1,"One same-tab session check at first render");
    assert.equal(calls.filter(call=>call==="/api/control?view=bootstrap").length,0,"No unrelated task, settings or finance rows in the initial requests");
    assert.equal(calls.filter(call=>call==="/api/control?view=shell").length,1,"One narrow shell request");
  } finally { for(const gate of gates.values())gate.open(); await context.close(); }
}

try {
  await run("/",["/api/control?view=today"],async (page,calls,open)=>{
    await page.locator("#dayline-start").getByRole("link",{name:"開工導航",exact:true}).waitFor();
    await page.getByRole("tab",{name:"任務總表"}).click();
    await page.getByText("讀取完整任務資料中…",{exact:true}).waitFor();
    assert.ok(calls.indexOf("/api/control?view=today_focus") < calls.indexOf("/api/control?view=today"));
    open("/api/control?view=today");
    await page.locator("#task-action-list").waitFor();
  });
  await run("/",[],async (page,calls)=>{
    await page.locator("#dayline-start").getByRole("link",{name:"開工導航",exact:true}).waitFor();
    assert.equal(calls.filter(call=>call==="/api/control?view=today").length,1,"Narrow failure falls back to the existing full view once");
  },true);
  await run(`/calendar?date=${day}`,["/api/apple-calendar-month"],async (page,calls,open)=>{
    await page.getByRole("heading",{name:"日曆",exact:true}).waitFor();
    await page.locator(".dl-calendar-selected").getByText(task.title,{exact:true}).waitFor();
    await page.getByText("讀緊呢個月嘅 iCloud 行程…",{exact:true}).waitFor();
    assert.equal(calls.filter(call=>call==="/api/control?view=calendar").length,1);
    open("/api/apple-calendar-month");
    await page.getByText("尚未連接 iCloud Calendar。",{exact:true}).waitFor();
  });
  console.log("PASS: one auth check; no whole-site bootstrap; Today opens during delayed catalog; Calendar opens during delayed Apple.");
} finally { await browser.close(); }
