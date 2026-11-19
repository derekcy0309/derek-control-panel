import assert from "node:assert/strict";
import test from "node:test";
import { validSchoolProposal,schoolBriefText } from "../lib/school-bot.ts";
const id="11111111-1111-4111-8111-111111111111", ref={itemId:id,version:"2026-11-19T11:20:30.123456+00:00"};
test("school change contract: identifiers, required version, title/date only, no implicit approval",()=>{
  const make=(operation:string,changes:object,extra={})=>({requestId:id,operation,changes,...extra});
  assert.ok(validSchoolProposal(make("create",{title:"通告",date:null})));
  assert.ok(validSchoolProposal(make("update",{date:"2028-02-29"},ref)));
  assert.ok(validSchoolProposal(make("delete",{},ref)));
  for(const invalid of [make("confirm",{},ref),make("update",{} ,ref),make("delete",{}),make("update",{date:"2026-02-29"},ref),make("create",{title:" "}),make("create",{title:"x",description:"private"}),make("create",{title:"x"},{owner_id:id}),make("update",{title:"a\nb"},ref),make("delete",{title:"x"},ref)])assert.equal(validSchoolProposal(invalid),false);
});
test("compact school brief stays opt-in, groups masked duplicates, no resource ids, reports truncation",()=>{
  assert.equal(schoolBriefText({enabled:false,items:[{title:"MUST NOT OUTPUT"}]}),"");
  const row={title:"學校事項",date:"2026-11-19",id};const text=schoolBriefText({enabled:true,items:[row,row],more:true});
  assert.match(text,/11-19 · 學校事項 ×2/);assert.match(text,/另有/);assert.ok(!text.includes(id));assert.match(schoolBriefText({enabled:true,items:[]}),/三日內冇事項/);
});
