// Use a fake account and intercepted endpoints; this test never writes real user data.
// VERIFY_URL must be loopback by default. A hosted run requires the authenticated
// Preview browser adapter, passed via PLAYWRIGHT_MODULE, to open the Vercel gate.
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const origin = new URL(process.env.VERIFY_URL || "http://127.0.0.1:3197").origin;
assert.ok(new URL(origin).hostname === "127.0.0.1" || /^https:\/\/derek-control-panel-[a-z0-9]+-derekcy0309-4881s-projects\.vercel\.app$/.test(origin));
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, headless: true });
const user = "11111111-1111-4111-8111-111111111111";
const now = "2026-11-23T00:32:00Z", date = "2026-11-23", dates = [date, "2026-11-24", "2026-11-25"];
const key = n => "88888888-8888-4888-8888-" + String(n).padStart(12,"0");
const article = {
  id:key(301), series:"home", title:"社區照護刊物：測試期", published:"2026-11-21", from:"2026-11-08", until:"2026-11-21",
  lead:"只在隔離測試環境使用。", snippet:null, anchor:null, version:1,
  blocks:[{text:"測試完整內文",heading:true,links:[]},{text:"出院支援段落。",heading:false,links:[{label:"示例來源",href:"https://example.test/source"}]}],
  revision:"a".repeat(64), sourceKind:"manual"
};
const roadCalls = "/api/hk-traffic";
const makeTask = (n,title,next_action) => ({
  id:key(n), user_id:user, owner_id:user, title, next_action, scope:"home", area:"personal", source_type:"follow_up",
  status:"not_started", due_date:n===1?date:null, follow_up_date:null, risk:"low", notes:null, completed_at:null,
  deleted_at:null, archived_at:null, created_at:now, updated_at:now, requested_priority:1, personal_tag_ids:[]
});
const taskSample = [makeTask(1,"按手排次序先做","打開會議記錄。"),makeTask(2,"第二件待辦","睇回條。"),makeTask(3,"第三件待辦","開新文件。")];
const appleEvent = { id:"fixture-apple",uid:"fixture-apple",title:"測試 iPhone 行程",start:date+"T12:30:00+08:00",end:date+"T13:30:00+08:00",source:"Apple",allDay:false };
const photoDir = process.env.DAYLINE_EDITORIAL_SCREENSHOTS;
if (photoDir) await mkdir(photoDir,{recursive:true});

function contrastRatio(foreground, background) {
 const luminance = color => {
  assert.match(color, /^rgb\(/, `Expected an opaque sRGB color, got ${color}`);
  return color.match(/\d+(?:\.\d+)?/g).map(Number).map(value => {
   const s = value / 255;
   return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
  }).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
 };
 const a = luminance(foreground), b = luminance(background);
 return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
}

async function expectContrast(locator, description) {
 const target=locator.first();
 await target.waitFor({state:"visible"});
 const {foreground,background}=await target.evaluate(el=>{
  let surface=el;
  while (getComputedStyle(surface).backgroundColor==="rgba(0, 0, 0, 0)" && surface.parentElement) surface=surface.parentElement;
  return {foreground:getComputedStyle(el).color,background:getComputedStyle(surface).backgroundColor};
 });
 const ratio=contrastRatio(foreground,background);
 assert.ok(ratio>=4.5,`${description}: ${ratio.toFixed(2)}:1 (${foreground} on ${background})`);
 return ratio;
}

try {
 for (const width of [360,1280]) {
  const ctx = await browser.newContext({ viewport:{width,height:900}, serviceWorkers:"block", locale:"zh-HK", timezoneId:"Asia/Hong_Kong", reducedMotion:"reduce" });
  try {
   const p = await ctx.newPage(), errors = [], calls = [], writes = [];
   const tasks = taskSample.slice();
   let optedIn = false, read = false, saved = false, denyDetail = false;
   p.setDefaultTimeout(15000);
   p.on("pageerror",e=>errors.push(e.message));
   await p.clock.setFixedTime(new Date(now));
   await p.route("**/*",async route=>{
    const request=route.request(), url=new URL(request.url()), part=url.pathname, q=url.searchParams, view=q.get("view");
    if(url.origin!==origin)return route.abort();
    if(!part.startsWith("/api/"))return ["GET","HEAD"].includes(request.method())?route.continue():route.abort();
    calls.push(part);
    const write=request.method()==="POST"?request.postDataJSON():null;
    let json={},status=200;
    if(write)writes.push({part,body:write});
    if(part==="/api/auth")json={user:{id:user}};
    else if(part==="/api/control"){
     if(write?.action==="create_task"){const task=makeTask(10,write.title,"");tasks.push(task);json={task};}
     else if(write){status=422;json={error:"意外嘅測試操作"};}
     else if(view==="assignment_alerts")json={assignments:[],currentUserId:user};
     else if(view==="task_tags")json={tags:[],taskTagIds:[]};
     else if(view==="work_guide")json={steps:[],checkpoint:null,openChildren:false};
     else json={
       currentUser:{id:user,displayName:"測試用戶",email:"dayline@example.test"}, profile:{user_id:user,active:true,workspace_role:"derek"},settings:{theme:"light"},
       tasks,taskQueueCatalog:tasks,taskCatalog:tasks,taskTags:[],participants:[{user_id:user,display_name:"測試用戶"}],taskFollowers:[],
       planning:taskSample.map((t,i)=>({user_id:user,resource_type:"task",resource_id:t.id,planned_date:date,plan_role:i?"later":"now",plan_source:"manual",plan_position:i+1})),
       operatingItems:[],assignments:[],shares:[],taskNoticeRecipients:[],taskDependencies:[],reminders:[],capacityCommitments:[]
     };
    } else if(part==="/api/information")json={prefs:{journals:optedIn,news:optedIn,traffic:true},routes:["r3","cht","tm-in","tm-out","airport"]};
    else if(part==="/api/publications/publisher")json={connections:[]};
    else if(part==="/api/publications"){
      const row={...article,read,saved,...(q.get("q")?{snippet:"出院支援段落。",anchor:1}:{})};
      if(write?.action==="save"){saved=write.wanted;json={ok:true};}
      else if(write?.action==="read"){read=true;json={ok:true};}
      else if(view==="count")json={unread:optedIn&&!read?1:0};
      else if(view==="issue"){if(!optedIn||denyDetail){status=404;json={error:"帳戶未獲授權"};}else json={issue:row};}
      else json={items:optedIn&&(q.get("mode")!=="saved"||saved)&&(q.get("mode")!=="unread"||!read)?[row]:[],more:false};
    } else if(part==="/api/calendar-brief")json={
      generatedAt:now,from:date,untilExclusive:"2026-11-26",days:dates.map((d,i)=>({date:d,events:i===0?[appleEvent]:[],deadlines:i===0?[{id:tasks[0].id,title:tasks[0].title,due:date,priority:1,status:"not_started"}]:[]})),
      familyDates:[{id:key(401),date:dates[1],kind:"school",title:"測試學校回條"}],sources:[{label:"Apple Calendar",state:"fresh",lastSync:now}],warnings:[],text:"隔離測試"
    };
    else if(part==="/api/weather/hong-kong")json={observed:{temperature:21,icon:50,at:now},forecast:dates.map(date=>({date,low:19,high:23,icon:50,description:"天晴"})),warnings:[],checkedAt:now};
    else if(part==="/api/start-links")json={links:[],shortcuts:[],ownerId:user};
    else if(part===roadCalls)json={
      at:now,vehicle:q.get("vehicle")||"PC",period:"weekday",variableOK:true,fixedOK:true,
      roads:[{key:"K04:CH",origin:"K04",start:"公主道",dest:"紅隧",area:"九龍",status:"slow",minutes:18,at:now}],
      spots:[{id:"TDS90020",label:"屯門公路近汀九西行",kph:46,at:now}],notices:[],
      tolls:["海底隧道","東區海底隧道","西區海底隧道","大欖隧道"].map((name,i)=>({name,fee:(q.get("vehicle")==="MC"?[16,16,24,18]:[40,40,60,45])[i],variable:true,until:"2026-11-23T02:00:00Z",revised:"2026-01-01"}))
    };
    await route.fulfill({json,status});
   });
   async function fit(label){assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label+" "+width);}
   const photo=(label)=>photoDir?p.screenshot({path:fileURLToPath(new URL(`./${label}-${width}.png`,pathToFileURL(photoDir+"/"))),fullPage:true,animations:"disabled",style:"nextjs-portal{display:none!important}"}):null;
   await p.goto(origin+"/");const start=p.locator("#dayline-start").getByRole("link",{name:"開工導航",exact:true});await start.waitFor();
   await p.getByText(tasks[0].next_action,{exact:true}).first().waitFor();
   const nowCard=p.locator(".dl-editorial-board .dl-focus");
   for (const theme of ["light","dark"]) {
    await p.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    const samples=await nowCard.evaluate(card=>["h2",".dl-first p",".dl-step-kicker",".dl-focus-chip",".dl-focus-order",".dl-tag",".dl-primary",".dl-guide-caption"].map(selector=>{
     const el=card.querySelector(selector);
     if (!el) throw new Error(`Missing ${selector}`);
     let surface=el;
     while (getComputedStyle(surface).backgroundColor==="rgba(0, 0, 0, 0)" && surface.parentElement) surface=surface.parentElement;
     return {selector,foreground:getComputedStyle(el).color,background:getComputedStyle(surface).backgroundColor};
    }));
    for (const {selector,foreground,background} of samples) {
     const ratio=contrastRatio(foreground,background);
     assert.ok(ratio>=4.5,`「現在處理」 ${width}px ${theme} ${selector}: ${ratio.toFixed(2)}:1 (${foreground} on ${background})`);
    }
    await fit(`「現在處理」 ${theme}`);
    if (theme==="dark") await photo("today-dark");
    console.log(`PASS 「現在處理」 ${width}px ${theme}: all 8 text colors at least 4.5:1`);
   }
   await p.evaluate(()=>{document.documentElement.dataset.theme="light";});
   if (process.env.DAYLINE_NOW_CONTRAST_ONLY === "1") { assert.deepEqual(errors,[]); continue; }
   if (process.env.DAYLINE_PAGE_CONTRAST_ONLY === "1") {
    const customTheme=theme=>p.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    const reports=[];
    const sample=async (selector,description)=>reports.push([description,await expectContrast(p.locator(selector),description)]);
    for (const theme of ["light","dark"]) {
     await p.goto(origin+"/");
     await p.locator(".dl-weather .dl-temp").first().waitFor();
     await customTheme(theme);
     for (const [selector,name] of [[".dl-harbour-figure figcaption","weather caption"],[".dl-weather .dl-temp","temperature"],[".dl-weather .dl-current small","weather details"],[".dl-weather .dl-forecast-toggle","forecast button"]]) {
      await sample(selector,`${theme} ${name}`);
     }
     await p.goto(origin+"/calendar?date="+date);
     const dateSelector=width<700?".dl-calendar-week button[aria-pressed='true']":".dl-calendar-grid [aria-current='date'] .dl-calendar-number";
     await p.locator(dateSelector).waitFor();
     await customTheme(theme);
     await sample(dateSelector,`${theme} calendar date`);
     if(width>=700)await sample(".dl-calendar-grid button[data-other='true']",`${theme} next month date`);
     optedIn=true;
     await p.goto(origin+"/briefing");
     await p.getByRole("link",{name:"睇期刊",exact:true}).waitFor();
     await customTheme(theme);
     reports.push([`${theme} Reading Room link`,await expectContrast(p.getByRole("link",{name:"睇期刊",exact:true}),`${theme} Reading Room link`)]);
     await p.goto(origin+"/traffic");
     await p.getByText("HK$ 45",{exact:true}).first().waitFor();
     await customTheme(theme);
     for(const [selector,name] of [["#dl-traffic-title","traffic heading"],[".dl-road-heading p","traffic intro"],[".dl-road-atlas figcaption","map caption"],[".dl-road-choice[aria-pressed='true'] .dl-road-name small","selected route label"],[".dl-road-choice[aria-pressed='true'] .dl-road-value","selected route data"],[".dl-toll-section select","vehicle selector"],[".dl-home-fares strong","toll price"],[".dl-toll-section > small","toll source"]]){
      await sample(selector,`${theme} ${name}`);
     }
     await p.getByRole("button",{name:"揀路段",exact:true}).click();
     await sample(".dl-road-desk .dl-linkform select",`${theme} route picker`);
     await sample(".dl-road-desk .dl-linkform button[type='submit']",`${theme} save route`);
     await fit(`Traffic ${theme}`);
    }
    assert.deepEqual(errors,[]);
    console.log(`PASS ${width}px Dayline colour pairs: ${reports.length} light/dark samples, minimum ${Math.min(...reports.map(([,ratio])=>ratio)).toFixed(2)}:1`);
    continue;
   }
   await p.getByText(appleEvent.title,{exact:true}).first().waitFor({state:"attached"});
   assert.equal(await p.getByRole("link",{name:/期未讀/}).count(),0);
   assert.equal(await p.locator(".dl-traffic-mini,.dl-home-fares").count(),0);
   assert.equal(calls.filter(x=>x===roadCalls).length,0,"Today must not fetch traffic even with an old saved traffic preference");
   await fit("Today");await photo("today");
   if(width===360)assert.ok((await start.boundingBox()).y<770,"Start action must fit on the first phone screen");
   await p.getByRole("button",{name:"加 Task",exact:true}).click();
   const form=p.getByRole("form",{name:"新增任務"});assert.equal(await form.locator("input:visible,textarea:visible,select:visible").count(),1);
   await form.getByLabel("任務名稱",{exact:true}).fill("只填名稱嘅測試工作");
   await form.locator("button[type=submit]").click();
   await p.getByText("任務已儲存。",{exact:true}).first().waitFor();
   assert.ok(writes.some(x=>x.part==="/api/control"&&x.body.action==="create_task"&&x.body.title==="只填名稱嘅測試工作"));
   await p.goto(origin+"/calendar?date="+date);
   await p.getByRole("heading",{name:/日曆/}).first().waitFor();await fit("Calendar");await photo("calendar");
   await p.goto(origin+"/briefing");await p.getByRole("heading",{name:"資訊站",exact:true}).first().waitFor();
   await p.getByText("想睇咩，由你話事").waitFor();
   assert.equal(await p.getByRole("link",{name:"睇期刊"}).count(),0);
   optedIn=true;await p.reload();await p.getByRole("link",{name:"睇期刊"}).click();
   await p.getByRole("link",{name:article.title}).waitFor();await fit("Publications");
   await p.getByRole("button",{name:/收藏/}).first().click();
   await p.getByRole("button",{name:/已收藏/}).first().waitFor();assert.equal(read,false);
   denyDetail=true;await p.getByRole("link",{name:article.title}).click();
   await p.getByRole("alert").filter({hasText:/未獲授權/}).waitFor();assert.equal(read,false);
   denyDetail=false;await p.getByRole("button",{name:"重試",exact:true}).click();
   await p.getByRole("heading",{name:"測試完整內文"}).waitFor();
   await p.getByText("已讀",{exact:true}).last().waitFor();
   assert.equal(read,true);
   await p.goto(origin+"/briefing");await p.getByRole("link",{name:"睇期刊"}).waitFor();await fit("Reading Room");await photo("reading");
   await p.goto(origin+"/briefing/traffic");await p.waitForURL(origin+"/traffic");
   await p.getByRole("heading",{name:/交通/}).first().waitFor();
   await p.getByText(/46\s*km\/h/).first().waitFor();assert.ok(calls.includes(roadCalls));
   await p.getByRole("button",{name:/入屯門/}).first().click();
   assert.match(await p.locator(".dl-road-pin[data-selected=true]").getAttribute("transform"),/351\.4 197\.2/);
   await p.getByRole("combobox",{name:"車種"}).selectOption("MC");
   await p.getByText("HK$ 24",{exact:true}).first().waitFor();
   await fit("Traffic");await photo("traffic");assert.deepEqual(errors,[]);
   console.log(`PASS ${width}px: Today without traffic request, name-only task, calendar, reading opt-in, save/read/deny, separate traffic with real endpoint shape`);
  }finally{await ctx.close();}
 }
}finally{await browser.close();}
