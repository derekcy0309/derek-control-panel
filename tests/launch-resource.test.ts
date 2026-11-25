import test from "node:test";
import assert from "node:assert/strict";
import { pickLaunchResource, launchHttps } from "../lib/launch-resource.ts";
import { safeLoginDestination } from "../lib/google-login.ts";

const id = "88888888-1111-4111-8111-111111111111";
const owner="owner";
const url={label:"上一版",url:"https://docs.example.test/one",resource_type:"url"};
test("own checkpoint wins over task links; executable, credential-bearing and invalid URLs stay out",()=>{
  assert.deepEqual(pickLaunchResource([url],[{...url,label:"上次讀到",url:"https://docs.example.test/two"}],owner),
    {kind:"web",label:"上次讀到",href:"https://docs.example.test/two"});
  for(const value of [undefined,"javascript:alert(1)","//external.test","https://name:pw@a.test","https://a.test/ x","https://a.test\\example.test"])
    assert.equal(launchHttps(value),null);
  assert.equal(pickLaunchResource([{...url,url:"javascript:bad"}],[],owner),null);
});
test("storage only returns a readable label/id; no paths, secrets or contact material",()=>{
  assert.deepEqual(pickLaunchResource([{label:"存檔",id,resource_type:"storage_file",url:"secret"}],[],owner),{kind:"file",label:"存檔",resourceId:id});
  assert.equal(pickLaunchResource([{label:"聯絡人",id,resource_type:"contact",url:"https://docs.test"}],[],owner),null);
});
test("internal targets require an RLS-visible item addressable in the intended view",()=>{
  const row={label:"草稿",resource_type:"note",linked_item_id:id};
  assert.equal(pickLaunchResource([row],[],owner),null);
  const item={id,item_type:"note",owner_id:owner,area:"personal",status:"open"};
  assert.deepEqual(pickLaunchResource([{...row,item}],[],owner),{kind:"item",label:"草稿",href:"/workspace/note#item-"+id});
  for(const override of [{owner_id:"another"},{archived_at:"2026"},{item_type:"sop"},{area:"family"},{id:"other"}])
    assert.equal(pickLaunchResource([{...row,item:{...item,...override}}],[],owner),null);
});
test("daily entry survives login only as one fixed internal fragment; queries or tokens never travel with it",()=>{
  assert.equal(safeLoginDestination("/#dayline-start"),"/#dayline-start");
  assert.equal(safeLoginDestination("/?access_token=secret#dayline-start"),"/#dayline-start");
  assert.equal(safeLoginDestination("/#dayline-start&token=secret"),"/");
  assert.equal(safeLoginDestination("//other.test/#dayline-start"),"/");
});
