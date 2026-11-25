// Synthetic browser/UI contract only. No real accounts, dictation/audio or external sends.
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
const origin=new URL(process.env.VERIFY_URL || "http://127.0.0.1:3219").origin;
assert.ok(["localhost","127.0.0.1"].includes(new URL(origin).hostname));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:"playwright");
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined});
const user="81230000-0000-4000-8000-000000000001", id="81230000-0000-4000-8000-000000000002";
const today="2026-11-25",now="2026-11-25T01:00:00Z";
const task={id,title:"試寫會議草稿",user_id:user,owner_id:user,area:"personal",scope:"home",source_type:"follow_up",status:"not_started",requested_priority:1,created_at:now,updated_at:now,personal_tag_ids:[]};
const data={currentUser:{id:user,displayName:"測試"},profile:{user_id:user,active:true,display_name:"測試"},settings:{theme:"light",focus_minutes:25},participants:[],tasks:[task],taskCatalog:[task],taskQueueCatalog:[task],taskTags:[],planning:[{user_id:user,resource_id:id,resource_type:"task",planned_date:today,plan_role:"now",plan_source:"manual",plan_position:1}],taskFollowers:[],assignments:[],taskNoticeRecipients:[],taskDependencies:[],shares:[],taskSteps:[],capacity:null,capacityCommitments:[],reminders:[],notificationPreferences:null,calendarConnections:[]};
try {
  for(const width of [390,1280]){
    const ctx=await browser.newContext({viewport:{width,height:850},timezoneId:"Asia/Hong_Kong",locale:"zh-HK",serviceWorkers:"block"}), page=await ctx.newPage();
    page.setDefaultTimeout(30000);
    await page.clock.setFixedTime(new Date(now));
    let draft={text:"",revision:null},fails=false,revisions=0;
    const violations=[],errs=[];
    page.on("pageerror",e=>errs.push(e.message));
    await page.route("**/*",async r=>{
      const u=new URL(r.request().url()),verb=r.request().method();
      if(u.origin!==origin) return r.abort();
      if(u.pathname==="/api/task-working-draft"){
        assert.equal(u.searchParams.get("task"),id);assert.equal(r.request().headers()["x-dayline-account"],user);
        if(verb==="POST"){const {text,revision}=r.request().postDataJSON();
          if(fails) return r.fulfill({status:503,json:{error:"未同步。請重試。"}});
          if(revision!==draft.revision)return r.fulfill({status:409,json:{error:"另一個畫面已更新草稿。"}});
          draft={text,revision:String(++revisions)};
        }
        return r.fulfill({json:draft});
      }
      if(verb!=="GET" && u.pathname.startsWith("/api/")){violations.push([verb,u.pathname]);return r.abort();}
      if(!u.pathname.startsWith("/api/"))return r.continue();
      const view=u.searchParams.get("view");
      const json=u.pathname==="/api/auth"?{user:{id:user}}:u.pathname==="/api/control"?
        (view==="work_guide"?{steps:[],checkpoint:null,openChildren:false}:view==="assignment_alerts"?{assignments:[],currentUserId:user}:data):
        u.pathname==="/api/calendar-brief"?{from:today,untilExclusive:"2026-11-28",generatedAt:now,days:[],sources:[],familyDates:[]}:
        u.pathname==="/api/start-links"?{ownerId:user,links:[],shortcuts:[]}:u.pathname==="/api/information"?{prefs:{traffic:false,news:false,journals:false},routes:[]}:{};
      return r.fulfill({json});
    });
    try{
      await page.goto(origin+"/");
      await page.getByRole("button",{name:"講一句／寫草稿"}).click();
      const area=page.getByRole("region",{name:"工作草稿"});
      const field=area.getByRole("textbox");
      const sample="只係隔離測試：確認開會時間。";
      await field.fill(sample);
      await area.getByText("已儲存到我的筆記。").waitFor();
      assert.equal(draft.text,sample); assert.equal(revisions,1);
      await area.getByRole("button",{name:"收起草稿"}).click(); await area.getByRole("button",{name:"講一句／寫草稿"}).click();
      await area.getByText("已儲存到我的筆記。").waitFor(); assert.equal(await field.inputValue(),sample);
      fails=true; await field.fill(sample+" 未完成。");await area.getByRole("button",{name:"重試儲存"}).waitFor();
      await area.getByRole("button",{name:"收起草稿"}).click();await area.getByRole("button",{name:"繼續編輯"}).click();
      assert.ok((await field.inputValue()).endsWith("未完成。"));
      fails=false;await area.getByRole("button",{name:"重試儲存"}).click();await area.getByText("已儲存到我的筆記。").waitFor();
      draft={text:"另一個畫面修改",revision:"external-change"};await field.fill(sample+" 衝突。");
      await area.getByRole("button",{name:"重讀選項"}).waitFor();assert.equal(draft.text,"另一個畫面修改");
      await area.getByRole("button",{name:"重讀選項"}).click();await area.getByRole("button",{name:"放棄未儲存修改並收起"}).click();
      assert.ok(await page.evaluate(s=>![localStorage,sessionStorage].some(storage=>Object.values(storage).some(v=>String(v).includes(s))),sample));
      assert.deepEqual(violations,[]);assert.deepEqual(errs,[]);
      console.log("PASS working draft "+width+"px: text fallback, private load/save, archive-safe conflict, network retry, discard/keep, no browser storage or sends");
    }finally{await ctx.close();}
  }
}finally{await browser.close();}
