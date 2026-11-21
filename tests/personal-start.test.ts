import {test} from "node:test";
import assert from "node:assert/strict";
import {websiteAddress,homeLink} from "../lib/start-links.ts";
import {readStories,feeds} from "../lib/server/briefing-feeds.ts";
import {marketBrief,marketIndices,isNewsSection} from "../lib/briefing.ts";
test("saved links accept web addresses only, preserve paths, reject credentials",()=>{
  assert.equal(websiteAddress(" Example.com/a?x=1#b "),"https://example.com/a?x=1#b");
  for(const bad of ["javascript:alert(1)","data:text/html,Hi","file:///a","//elsewhere.test","https://u:p@example.com","https://ex ample.org","https://example.com\\bad",42])assert.equal(websiteAddress(bad),null);
  assert.equal(homeLink({id:"abc",title:"private",description:"https://example.com",metadata:{noteCategory:"我的網頁"}}),null);
  assert.equal(homeLink({id:"abc",title:"read",description:"https://example.com",metadata:{daylineShelf:"later"}})?.shelf,"later");
});
test("RSS/Atom: strip markup, use publisher links, de-duplicate and do not invent publication times",()=>{
  const f=feeds.local[0];const item=(title:string,url:string)=>'<item><title><![CDATA['+title+']]></title><link>'+url+'</link></item>';
  const rss='<rss><channel>'+item(' <i>本地新聞</i> ','https://news.rthk.hk/a')+item('重複','https://news.rthk.hk/a')+item('外站','https://example.com/a')+'</channel></rss>';
  assert.deepEqual(readStories(f,rss),[{title:"本地新聞",url:"https://news.rthk.hk/a",date:null,source:"香港電台"}]);
  const atom='<feed><entry><title>iPad 新機</title><link rel="self" href="https://www.apple.com/self"/><link rel="alternate" href="https://www.apple.com/hk/test"/><updated>2026-11-20T04:00:00Z</updated></entry><entry><title>其他</title><link href="https://www.apple.com/unrelated"/></entry></feed>';
  assert.equal(readStories(feeds.gadgets[0],atom)[0].url,"https://www.apple.com/hk/test");assert.equal(readStories(feeds.gadgets[0],atom).length,1);
  assert.throws(()=>readStories(f,'<!DOCTYPE rss [<!ENTITY data "no">]><rss/>'));assert.throws(()=>readStories(f,"<html/>"));assert.throws(()=>readStories(f,"x".repeat(700001)));
});
test("market brief separates the markets, avoids stale/future news, favours useful topics without implying a quote",()=>{
  const story=(title:string,date:string)=>({title,date,url:"https://example.com/news",source:"publisher"});
  const now=new Date("2026-11-21T13:00:00Z");const a=story("Stock market today","2026-11-20T20:00:00Z"),b=story("Other news","2026-11-21T02:00:00Z");
  const groups=[{label:"美股",source:"publisher",sourceUrl:"https://example.com",state:"ok" as const,stories:[b,a,story("IPO","2026-12-02")]},{label:"港股",source:"publisher",sourceUrl:"https://example.com",state:"ok" as const,stories:[story("恒指","2026-10-02")]}];
  assert.deepEqual(marketBrief(groups,now),[{market:"美股",story:a}]);assert.equal(isNewsSection("constructor"),false); assert.equal(marketIndices.length,6);
});
