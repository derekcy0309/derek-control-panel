import test from "node:test";
import assert from "node:assert/strict";
import { appleCalendarMonthWindow } from "../lib/apple-calendar-month.ts";
import { readSelectedAppleCalendars } from "../lib/integrations/apple-calendar.ts";

const window=appleCalendarMonthWindow("2026-12")!;
const calendar=(id:string)=>({id,name:id,url:"https://p1-caldav.icloud.com/calendars/"+id});
const calendars=Array.from({length:6},(_,index)=>calendar(String(index)));
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred<T>(){
  let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function object(id:string,title:string,date="20261218"){
  return {data:["BEGIN:VCALENDAR","VERSION:2.0","BEGIN:VEVENT","UID:"+id,"DTSTART:"+date+"T010000Z",
    "DTEND:"+date+"T020000Z","SUMMARY:"+title,"END:VEVENT","END:VCALENDAR"].join("\r\n")};
}

test("six selected calendar reports run in two bounded waves, never serially",async()=>{
  const gates=calendars.map(()=>deferred<ReturnType<typeof object>[]>());
  const requests:string[]=[];
  let active=0,peak=0;
  const pending=readSelectedAppleCalendars(calendars,window,async item=>{
    requests.push(item.id);
    peak=Math.max(peak,++active);
    try{return await gates[Number(item.id)].promise;}finally{active--;}
  });
  assert.deepEqual(requests,["0","1","2"]);
  gates[0].resolve([object("first","First")]);
  gates[2].resolve([object("last","Last","20261219")]);
  await tick();
  assert.deepEqual(requests,["0","1","2"]);
  gates[1].resolve([]);
  await tick();
  assert.deepEqual(requests,["0","1","2","3","4","5"]);
  for(const gate of gates.slice(3))gate.resolve([]);
  const result=await pending;
  assert.equal(peak,3);
  assert.deepEqual(result.events.map(event=>event.uid),["first","last"]);
  assert.equal(result.truncated,false);
});

test("last selection still wins duplicate records after out-of-order provider responses",async()=>{
  const first=deferred<ReturnType<typeof object>[]>();
  const pending=readSelectedAppleCalendars(calendars.slice(0,3),window,item=>item.id==="0"?first.promise:
    Promise.resolve(item.id==="1"?[object("shared","Updated")]:[object("next","Next","20261219")]),1);
  first.resolve([object("shared","Earlier")]);
  const result=await pending;
  assert.deepEqual(result.events.map(event=>event.title),["Updated"]);
  assert.equal(result.truncated,true);
});

test("a failed wave stops later reads and retains the first error in selection order",async()=>{
  const gates=calendars.map(()=>deferred<[]>());
  const requests:string[]=[];
  const pending=readSelectedAppleCalendars(calendars,window,item=>{
    requests.push(item.id);
    return gates[Number(item.id)].promise;
  });
  gates[1].reject(new Error("APPLE_NETWORK"));
  await tick();
  gates[0].reject(new Error("APPLE_AUTH_REQUIRED"));
  gates[2].resolve([]);
  await assert.rejects(pending,{message:"APPLE_AUTH_REQUIRED"});
  assert.deepEqual(requests,["0","1","2"],"no retries or later requests after failure");
});
