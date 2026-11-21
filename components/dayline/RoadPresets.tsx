"use client";
import {useState} from "react";
import {defaultRoads,presetNames,tollBoard,watchGroup} from "@/lib/road-presets";
import {tollSource,type Journey,type RoadReport} from "@/lib/roadwatch";
import type {useInfoChoices} from "./InfoChoices";
export type RoadChoiceModel=ReturnType<typeof useInfoChoices>;
const hkClock=new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false});
const clock=(s:string)=>hkClock.format(new Date(s));
export function RoutePicker({model,roads,onDone}:{model:RoadChoiceModel;roads:Journey[];onDone:(saved:boolean)=>void}){
 const [draft,set]=useState<string[]>(model.routes),[extra,choose]=useState("");
 function toggle(k:string){set(prev=>prev.includes(k)?prev.filter(v=>v!==k):prev.length<24?[...prev,k]:prev);}
 return <form className="dl-linkform" onSubmit={async e=>{e.preventDefault();if(await model.saveRoutes(draft))onDone(true);}}>
 <fieldset><legend>我想睇嘅路段</legend><div className="dl-road-options">{Object.entries(presetNames).map(([k,label])=><label key={k}><input type="checkbox" checked={draft.includes(k)} onChange={()=>toggle(k)}/>{label}</label>)}</div></fieldset>
 <label>其他運輸署行車路線<select value={extra} onChange={e=>choose(e.target.value)}><option value="">揀起點同方向</option>{roads.filter(r=>!draft.includes(r.key)).map(r=><option key={r.key} value={r.key}>{r.start} → {r.dest}</option>)}</select></label>
 <button type="button" className="dl-textbtn" disabled={!extra||draft.length>=24} onClick={()=>{if(extra)toggle(extra);choose("");}}>加入呢段路</button>
 {draft.filter(k=>!Object.hasOwn(presetNames,k)).map(k=><label key={k}><input type="checkbox" checked onChange={()=>toggle(k)}/>{watchGroup(k,roads,[]).label}</label>)}
 <p>最多 24 段。取消全部亦可以；四條隧道收費會保留。</p>{model.error?<p role="alert">{model.error}</p>:null}
 <div className="dl-library-tools"><button type="submit" disabled={model.busy||!model.ready}>儲存路段</button><button type="button" className="dl-textbtn" onClick={()=>set([...defaultRoads])}>用返建議路段</button><button type="button" className="dl-textbtn" onClick={()=>onDone(false)}>取消</button></div></form>;
}
export function FaresNow({data,now,vehicle,change}:{data:RoadReport|null;now:number;vehicle:"PC"|"MC";change:(next:"PC"|"MC")=>void}){
 const live=!!data&&data.vehicle===vehicle&&now-Date.parse(data.at)<=120000&&now-Date.parse(data.at)>=-120000;
 return <section className="dl-road-block dl-toll-section" aria-label="四條隧道而家收費"><div className="dl-road-sectionhead"><div><span className="dl-section-kicker">TUNNEL TOLLS</span><h2>隧道收費</h2></div><label>車種 <select aria-label="車種" value={vehicle} onChange={e=>change(e.target.value as "PC"|"MC")}><option value="PC">私家車</option><option value="MC">電單車</option></select></label></div>
 <ul className="dl-home-fares">{tollBoard(data?.tolls??[],now,live&&!!data?.variableOK).map(x=><li key={x.name}><span>{x.label}</span><strong>{x.fee!==null?"HK$ "+x.fee:"未能確認"}</strong></li>)}</ul>
 <small>{live&&data?"香港時間 "+clock(data.at)+" · ":""}按運輸署當時生效收費表，唔係個人扣款。 <a href={tollSource} target="_blank" rel="noreferrer">官方收費查詢</a></small></section>;
}
