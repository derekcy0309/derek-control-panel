export type RoadState="closed"|"jam"|"slow"|"clear"|"unknown";
export type Journey={key:string;origin:string;start:string;dest:string;area:"港島"|"九龍"|"新界";status:RoadState;minutes:number|null;at:string};
export type RoadNotice={id:string;place:string;direction:string;body:string;at:string};
export type Toll={name:string;fee:number;variable:boolean;until:string|null;revised:string|null};
export type RoadReport={at:string;roads:Journey[]|null;spots?:import("./road-presets.ts").Spot[]|null;notices:RoadNotice[]|null;tolls:Toll[];period:"weekday"|"holiday"|"unknown";variableOK:boolean;fixedOK:boolean;vehicle:"PC"|"MC"};
export const roadWords:Record<RoadState,string>={closed:"封閉",jam:"擠塞",slow:"較慢",clear:"暢順",unknown:"未有狀況"};
export function recentReading(at:string|undefined,now:number){const t=Date.parse(at??"");return Number.isFinite(t)&&now>=t-120000&&now-t<=10*60_000;}
export function trafficHighlights(rows:Journey[],now:number,count=3){
  const rank:Record<RoadState,number>={closed:0,jam:1,slow:2,clear:3,unknown:4};
  const seen=new Set<string>();return rows.filter(r=>recentReading(r.at,now)&&r.status!=="unknown").sort((a,b)=>rank[a.status]-rank[b.status]||b.at.localeCompare(a.at)||a.key.localeCompare(b.key)).filter(r=>{if(seen.has(r.origin))return false;seen.add(r.origin);return true;}).slice(0,count);
}
export const tollSource="https://www.hkemobility.gov.hk/tc/toll-rate/";
export const roadSource="https://data.gov.hk/tc-data/dataset/hk-td-sm_8-journey-time-indicators-v2";
export const tollTable="https://data.gov.hk/tc-data/dataset/hk-td-tis_15-road-network-v2";
