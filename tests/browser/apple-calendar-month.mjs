// Run against local Next with no real credentials. All account and Apple data
// is intercepted in the browser; this script cannot write user data.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const origin=new URL(process.env.VERIFY_URL||"http://127.0.0.1:3197").origin;
assert.equal(new URL(origin).hostname,"127.0.0.1","Calendar scenarios must run against loopback");
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:"playwright");
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
const user="71111111-1111-4111-8111-111111111111", now="2026-11-22T02:15:00Z";
const makeEvent=(id,title,start,end,allDay=false)=>({id,uid:id,title,start,end,allDay,source:"Apple"});
const withinThree=makeEvent("within-brief","首頁三日示例","2026-11-23T17:00:00+08:00","2026-11-23T18:00:00+08:00");
const later=makeEvent("outside-brief","十一月尾 iPhone 行程","2026-11-28T09:30:00+08:00","2026-11-28T10:30:00+08:00");
const overnight=makeEvent("overnight","十二月跨日 iPhone 行程","2026-12-16T22:30:00+08:00","2026-12-17T01:30:00+08:00");
const allDay=makeEvent("all-day","十二月全日 iPhone 行程","2026-12-16","2026-12-17",true);

try{
 for(const width of [360,1280]){
  const context=await browser.newContext({viewport:{width,height:920},serviceWorkers:"block",timezoneId:"Asia/Hong_Kong",locale:"zh-HK"});
  try{
   const page=await context.newPage(), errors=[], months=[], writes=[];
   let mode="fresh";
   page.on("pageerror",err=>errors.push(err.message));
   page.setDefaultTimeout(18000);
   await page.clock.setFixedTime(new Date(now));
   await page.route("**/*",async route=>{
    const request=route.request(),u=new URL(request.url());
    if(u.origin!==origin)return route.abort();
    const p=u.pathname;
    if(p.startsWith("/__nextjs"))return route.abort(); // Local dev overlay, never an app write.
    if(!["GET","HEAD"].includes(request.method())){writes.push(p);return route.abort();}
    if(!p.startsWith("/api/"))return route.continue();
    let json={},status=200;
    const source={label:"Apple Calendar",state:mode==="not_connected"?mode:"fresh",lastSync:mode==="not_connected"?null:now};
    if(p==="/api/auth")json={user:{id:user}};
    else if(p==="/api/control"){
     json=u.searchParams.get("view")==="assignment_alerts"?{assignments:[],currentUserId:user}:{
      currentUser:{id:user,displayName:"Calendar fixture"},profile:{user_id:user,active:true,workspace_role:"derek"},settings:{theme:"light"},
      tasks:[],operatingItems:[],taskTags:[],taskQueueCatalog:[],taskCatalog:[],taskFollowers:[],participants:[],assignments:[],shares:[],
      planning:[],taskNoticeRecipients:[],taskDependencies:[],reminders:[],capacityCommitments:[]
     };
    }else if(p==="/api/calendar-brief"){
     assert.ok(u.search===""||u.search==="?view=work-stop","Home stays on its existing three-day endpoints");
     json=u.search?{events:[withinThree],generatedAt:now,incomplete:false,panelOnly:false}:{generatedAt:now,from:"2026-11-22",untilExclusive:"2026-11-25",days:[
      {date:"2026-11-22",events:[],deadlines:[]},{date:"2026-11-23",events:[withinThree],deadlines:[]},{date:"2026-11-24",events:[],deadlines:[]}
     ],familyDates:[],sources:[source],warnings:[],text:"只限三日"};
    }else if(p==="/api/apple-calendar-month"){
     const month=u.searchParams.get("month");
     assert.ok(["2026-11","2026-12","2027-01"].includes(month));
     assert.deepEqual([...u.searchParams.keys()],["month"]);
     months.push(month);
     const bounds={"2026-11":["2026-10-26","2026-12-07"],"2026-12":["2026-11-30","2027-01-04"],"2027-01":["2026-12-28","2027-02-01"]}[month];
     // Different months have independent outcomes. The dashboard fixture
     // never includes these title(s), so this proves the selected-month API is used.
     json={month,from:bounds[0],until:bounds[1],events:mode==="fresh"?(month==="2026-11"?[withinThree,later]:month==="2026-12"?[overnight,allDay]:[]):[],source,truncated:false};
     if(mode==="error"){status=503;json={error:"Apple Calendar 暫時未能更新"};}
    }else if(p==="/api/information")json={prefs:{journals:false,news:false,traffic:false},routes:[]};
    else if(p==="/api/start-links")json={links:[],shortcuts:[],ownerId:user};
    else if(p==="/api/weather/hong-kong")json={observed:null,forecast:[],warnings:[],checkedAt:now};
    await route.fulfill({status,json});
   });
   async function assertFit(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
   await page.goto(origin+"/calendar?date=2026-11-28");
   await page.getByRole("heading",{name:"日曆",exact:true}).waitFor();
   const selected=page.locator(".dl-calendar-selected");
   await selected.getByText(later.title,{exact:true}).waitFor();
   await selected.getByText(/iPhone.*唯讀/).first().waitFor();
   assert.ok(months.includes("2026-11"));
   await assertFit();
   await page.getByRole("button",{name:"下個月",exact:true}).click();
   await page.getByRole("heading",{name:"2026 年 12 月",exact:true}).waitFor();
   await page.getByText("睇全月安排",{exact:true}).click();
   await page.locator(".dl-calendar-overview").getByText(overnight.title,{exact:true}).first().waitFor();
   assert.equal(await page.locator(".dl-calendar-overview").getByText(overnight.title,{exact:true}).count(),2,"Timed event appears on both overlapped HK dates");
   assert.equal(await page.locator(".dl-calendar-overview").getByText(allDay.title,{exact:true}).count(),1,"All-day DTEND is exclusive");
   assert.ok(months.includes("2026-12"));
   await assertFit();

   mode="error";
   await page.getByRole("button",{name:"下個月",exact:true}).click();
   await page.getByRole("heading",{name:"2027 年 1 月",exact:true}).waitFor();
   await page.locator("#main-content").getByText(/未能|未讀到|未更新|失敗/).first().waitFor();
   const before=months.filter(m=>m==="2027-01").length;
   mode="not_connected";
   await page.getByRole("button",{name:"更新 iPhone 行程",exact:true}).click();
   await page.getByText("尚未連接 iCloud Calendar。",{exact:false}).first().waitFor();
   assert.ok(months.filter(m=>m==="2027-01").length>before);
   assert.equal(await page.getByText(overnight.title,{exact:true}).count(),0,"Older month must not appear under a failed or disconnected month");

   mode="fresh";
   const monthRequests=months.length;
   await page.goto(origin+"/");
   await page.getByRole("heading",{name:"今日總覽",exact:true}).waitFor();
   await page.getByText(withinThree.title,{exact:true}).first().waitFor({state:"attached"});
   assert.equal(months.length,monthRequests,"Today must still only request the short brief");
   assert.equal(await page.getByText(later.title,{exact:true}).count(),0);
   assert.deepEqual(writes,[]);
   assert.deepEqual(errors,[]);
   console.log(`PASS ${width}px: selected-month request, out-of-three-day event, cross-midnight display, exclusive all-day end, retry and unchanged Today brief.`);
  }finally{await context.close();}
 }
}finally{await browser.close();}
