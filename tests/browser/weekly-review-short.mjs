// Offline synthetic API fixture; exercise the real page on phone and desktop.
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
const origin=new URL(process.env.VERIFY_URL||"http://127.0.0.1:3219").origin;
assert.ok(["localhost","127.0.0.1"].includes(new URL(origin).hostname));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:"playwright");
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined});
const uid="81230000-0000-4000-8000-000000000001",week="2026-11-23",otherWeek="2026-11-16";
const seed={id:uid,user_id:uid,week_start:week,status:"draft",next_week_outcomes:["舊成果一","舊成果二"],next_week_available_minutes:70,rebalancing_note:"等候電郵",next_minimum_action:"打開文件",reflection:"保留舊備註",updated_at:"2026-11-25T08:00:00Z"};
const conflictMessage="另一個畫面已儲存較新版本。本頁的輸入仍然保留，沒有覆蓋已儲存的內容。";
try{
 for(const width of [390,1280]){
  const ctx=await browser.newContext({viewport:{width,height:850},timezoneId:"Asia/Hong_Kong",locale:"zh-HK",serviceWorkers:"block"}),page=await ctx.newPage();
  page.setDefaultTimeout(17000);
  let current={...seed},fail=false;const history={...seed,id:"previous",week_start:otherWeek,status:"completed",reflection:"前一週的想法"};
  const writes=[],unexpected=[],errors=[];let reads=0;page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",async r=>{
    const req=r.request(),u=new URL(req.url());if(u.origin!==origin)return r.abort();
    if(!u.pathname.startsWith("/api/"))return r.continue();
    if(u.pathname==="/api/auth")return r.fulfill({json:{user:{id:uid}}});
    if(u.pathname==="/api/control"&&req.method()==="GET"&&u.searchParams.get("view")==="weekly_review"){
      reads++;const w=u.searchParams.get("weekStart")||week;return r.fulfill({json:{owner_id:uid,week_start:w,week_end:"2026-11-29",next_week_start:"2026-11-30",next_week_end:"2026-12-06",completed:[],active:[],blocked:[],waiting:[],upcoming:[],counts:{completed:0,active:0,blocked:0,waiting:0,upcoming:0},known_estimated_minutes:0,review:w===week?current:history,history:[current,history]}});
    }
    if(u.pathname==="/api/control"&&req.method()==="POST"){
      const b=req.postDataJSON();writes.push(b);if(b.action!=="save_weekly_review"){unexpected.push(b.action);return r.abort();}
      if(fail||b.expectedUpdatedAt!==current.updated_at)return r.fulfill({status:409,json:{error:conflictMessage}});
      current={...current,next_week_outcomes:b.nextWeekOutcomes.filter(Boolean),next_week_available_minutes:b.nextWeekAvailableMinutes,rebalancing_note:b.rebalancingNote,next_minimum_action:b.nextMinimumAction,reflection:b.reflection,status:b.complete?"completed":"draft",updated_at:"2026-11-25T09:00:00Z"};
      return r.fulfill({json:{review:current}});
    }
    if(req.method()!=="GET"){unexpected.push(u.pathname);return r.abort();}
    return r.fulfill({json:u.searchParams.get("view")==="assignment_alerts"?{assignments:[],currentUserId:uid}:{}});
  });
  try{
    await page.goto(origin+"/weekly-review");
    const good=page.getByRole("textbox",{name:"本週有甚麼值得繼續？"}),wait=page.getByRole("textbox",{name:"有甚麼需要等候或轉交？"}),next=page.getByRole("textbox",{name:"下次開始時，第一步是甚麼？"});
    await good.waitFor();assert.equal(await good.inputValue(),seed.reflection);assert.equal(await wait.inputValue(),seed.rebalancing_note);assert.equal(await next.inputValue(),seed.next_minimum_action);
    assert.equal(await page.getByRole("textbox").count(),3);const baseline=reads;
    await good.fill("星期一先完成第一步");await page.getByRole("button",{name:"詳細檢視（八步）"}).click();
    await page.getByText("第 1／8 步").waitFor();for(let n=0;n<4;n++)await page.getByRole("button",{name:"下一步",exact:true}).click();
    assert.equal(await page.getByRole("textbox",{name:"結果 2"}).inputValue(),"舊成果二");
    await page.getByRole("textbox",{name:"結果 2"}).fill("更新後的第二個成果");
    await page.getByRole("button",{name:"下一步",exact:true}).click();assert.equal(await page.getByRole("spinbutton").inputValue(),"70");
    await page.getByRole("button",{name:"簡短檢視"}).click();assert.equal(await good.inputValue(),"星期一先完成第一步");
    assert.equal(reads,baseline);assert.equal(writes.length,0);await page.getByRole("button",{name:"先儲存草稿"}).click();
    await page.getByText("草稿已儲存；你可隨時回來繼續。").waitFor();assert.equal(writes.length,1);
    assert.deepEqual(current.next_week_outcomes,["舊成果一","更新後的第二個成果"]);assert.equal(current.next_week_available_minutes,70);assert.equal(writes[0].expectedOwnerId,uid);assert.equal(writes[0].expectedUpdatedAt,seed.updated_at);
    fail=true;await good.fill("未儲存的新想法");await page.getByRole("button",{name:"先儲存草稿"}).click();await page.getByText(conflictMessage).waitFor();
    assert.equal(await good.inputValue(),"未儲存的新想法");assert.notEqual(current.reflection,"未儲存的新想法");
    page.once("dialog",dialog=>dialog.dismiss());await page.getByRole("button",{name:"重新讀取已儲存的版本"}).click();assert.equal(await good.inputValue(),"未儲存的新想法");
    await page.getByText("最近檢視",{exact:true}).click();page.once("dialog",dialog=>dialog.accept());
    await page.getByRole("button",{name:otherWeek+" · 已完成"}).click();await page.getByText("這次檢視已完成").waitFor();
    assert.equal(await good.inputValue(),"前一週的想法");assert.ok(await good.isDisabled());assert.equal(await page.getByRole("button",{name:"先儲存草稿"}).count(),0);
    assert.equal(writes.length,2);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
    console.log("PASS weekly review "+width+"px: 3 questions, eight-step view and previous values retained, opt-in save, stale update rejection retains input, history read-only, no task writes.");
  }finally{await ctx.close();}
 }
}finally{await browser.close();}
