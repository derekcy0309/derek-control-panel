import test from "node:test";
import assert from "node:assert/strict";
import {defaultRoads,tollBoard,validRoads,watchGroup} from "../lib/road-presets.ts";
import {detectorSpots} from "../lib/server/traffic-data.ts";
import {recentReading,type Journey,type Toll} from "../lib/roadwatch.ts";
const at="2026-11-21T12:00:00Z",t=Date.parse(at);
const road=(key:string):Journey=>({key,origin:key.split(":")[0],start:"起點",dest:"終點",area:"新界",minutes:17,status:"slow",at});
test("five requested preset groups; empty is a valid intentional choice; unknown or duplicate is rejected",()=>{
 assert.deepEqual(defaultRoads,["r3","cht","tm-in","tm-out","airport"]);assert.ok(validRoads([]));assert.ok(validRoads(["cht","K07:ACTT"]));for(const bad of [["cht","cht"],["nope"],{},["<script>"],Array(25).fill("tm-out")])assert.equal(validRoads(bad),false);
});
test("only the requested direction and corridor is selected; inbound Tuen Mun never borrows outbound journey times",()=>{
 const roads=["K04:CH","H2:CH","SJ5:TWTM","K07:ACTT","K07:ATSCA","N02:TMCLK","H2:WH"].map(road);
 assert.deepEqual(watchGroup("cht",roads,[]).roads.map(r=>r.key),["K04:CH","H2:CH"]);assert.deepEqual(watchGroup("tm-in",roads,[]).roads,[]);assert.deepEqual(watchGroup("tm-out",roads,[]).roads.map(r=>r.key),["SJ5:TWTM"]);assert.deepEqual(watchGroup("N02:TMCLK",roads,[]).roads.map(r=>r.key),["N02:TMCLK"]);
});
const lane=(speed:number,volume:number,valid:string)=>`<lane><speed>${speed}</speed><volume>${volume}</volume><valid>${valid}</valid></lane>`;
const detector=(id:string,lanes:string)=>`<detector><detector_id>${id}</detector_id><lanes>${lanes}</lanes></detector>`;
test("verified detector, direction, measured period, valid busy lanes and stale protection",()=>{
 const feed='<raw_speed_volume_list><date>2026-11-21</date><periods><period><period_to>20:00:00</period_to><detectors>'+detector("TDS90020",lane(10,2,"Y")+lane(40,4,"Y")+lane(150,12,"N")+lane(160,0,"Y"))+detector("AID05201",lane(55,3,"Y"))+detector("XX",lane(55,3,"Y"))+'</detectors></period></periods></raw_speed_volume_list>';
 const obs=detectorSpots(feed);assert.equal(obs.length,2);const inbound=watchGroup("tm-in",[],obs).spots;assert.equal(inbound.length,1);assert.equal(inbound[0].kph,30);assert.equal(Date.parse(inbound[0].at),t);assert.equal(recentReading(inbound[0].at,t+11*60000),false);assert.equal(watchGroup("tm-out",[],obs).spots[0].id,"AID05201");assert.throws(()=>detectorSpots(feed.slice(0,-15)));
});
test("four stable toll slots including Tai Lam; missing/expired/unknown fares never become a quote or zero",()=>{
 const arr:Toll[]=[{name:"海底隧道",fee:20,variable:true,until:new Date(t+1).toISOString(),revised:null},{name:"大欖隧道",fee:18,variable:true,until:at,revised:null}];
 assert.deepEqual(tollBoard(arr,t,true).map(x=>x.label),["紅隧","東隧","西隧","大欖隧道"]);assert.deepEqual(tollBoard(arr,t,true).map(x=>x.fee),[20,null,null,null]);assert.ok(tollBoard(arr,t,false).every(x=>x.fee===null));
});
