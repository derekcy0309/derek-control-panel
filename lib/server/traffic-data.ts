import xml from "xml-js";
import type {Element} from "xml-js";
import type {Journey,RoadNotice,RoadState,Toll} from "../roadwatch.ts";
import {detectorNames,type Spot} from "../road-presets.ts";
// Short place names follow TD's Journey Time Indicators v2 spec; do not guess new IDs.
const starts:Record<string,string>={H1:"告士打道東行（稅務大樓）",H2:"堅拿道天橋北行",H3:"東區走廊西行（城市花園）",H4:"黃泥涌道北行",H5:"興發街北行",H6:"淺水灣道北行",H7:"黃竹坑道北行",H8:"黃竹坑道東行",H9:"鴨脷洲橋道北行",H11:"東區走廊西行（鯉景灣）",K01:"渡船街南行",K02:"加士居道東行",K03:"窩打老道南行",K04:"公主道南行",K05:"啟福道北行",K06:"漆咸道北南行",K07:"西九龍公路西行（南昌）",K08:"啟祥道西行",N01:"洪天路南行",N02:"朗天路南行",N03:"元朗公路東行（十八鄉）",N05:"大埔公路東行（廣福邨）",N06:"青沙公路西行",N07:"福民路北行",N08:"寶順路南行（頌明苑）",N09:"環保大道西行",N10:"寶康路南行",N11:"寶邑路西行",N12:"寶順路南行（調景嶺）",N13:"翠嶺路東行",SJ1:"大埔公路南行（沙田馬場）",SJ2:"大老山隧道公路南行（石門）",SJ3:"吐露港公路南行（科學園）",SJ4:"新田公路南行（錦綉花園）",SJ5:"屯門公路南行（井財街）"};
const ends:Record<string,string>={CH:"紅隧",EH:"東隧",WH:"西隧",ABT:"灣仔（香港仔隧道）",WNCG:"灣仔（黃泥涌峽道）",PFL:"中區（薄扶林道）",ACTT:"機場（三號幹線）",ATSCA:"機場（八號幹線）",ATL:"機場（大欖隧道）",TMCLK:"機場（屯門赤鱲角隧道）",SSCPR:"上水（青山公路）",SSYLH:"上水（九號幹線）",LRT:"九龍中（獅子山隧道）",SMT:"荃灣（城門隧道）",TCT:"九龍東（大老山隧道）",TKTL:"汀九（大欖隧道）",TKTM:"汀九（屯門公路）",TLH:"沙田（吐露港公路）",TPR:"沙田（大埔公路）",KTPR:"九龍（大埔公路）",TSCA:"西九龍（八號幹線）",TWCP:"荃灣西（青山公路）",TWTM:"荃灣西（屯門公路）",CWBR:"九龍（清水灣道）",MOS:"九龍（二號幹線）",TKOLTT:"九龍（將藍隧道）",TKOT:"九龍（將軍澳隧道）"};
function records(data:string,rootName:string,rowName:string){
  if(data.length>600000||/<!\s*(DOCTYPE|ENTITY)\b/i.test(data))throw Error("invalid xml");
  const root=(xml.xml2js(data,{compact:false,ignoreComment:true,ignoreInstruction:true}) as Element).elements?.find(x=>x.type==="element");
  if(root?.name!==rootName)throw Error("unexpected feed");
  return (root.elements??[]).filter(v=>v.name===rowName).slice(0,500).map(v=>Object.fromEntries((v.elements??[]).filter(c=>c.name).map(c=>[c.name!,c.elements?.map(x=>x.text??x.cdata??"").join("").trim()??""])) as Record<string,string>);
}
function hkTimestamp(value:string){if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)?$/.test(value??""))return null;const n=Date.parse(value.length===19?value+"+08:00":value);return Number.isFinite(n)?new Date(n).toISOString():null;}
export function journeys(data:string):Journey[]{
  const out=new Map<string,Journey>();
  for(const r of records(data,"jtis_journey_list","jtis_journey_time")){
    const origin=r.LOCATION_ID,start=starts[origin],dest=ends[r.DESTINATION_ID],at=hkTimestamp(r.CAPTURE_DATE);
    if(!start||!dest||!at)continue;
    const timed=r.JOURNEY_TYPE==="1"&&/^\d{1,2}$/.test(r.JOURNEY_DATA);
    const graphic=r.JOURNEY_TYPE==="2";
    const status:RoadState=graphic?(r.JOURNEY_DATA==="3"?"closed":r.JOURNEY_DATA==="1"?"jam":"unknown"):timed?({"1":"jam","2":"slow","3":"clear"} as const)[r.COLOUR_ID as "1"|"2"|"3"]??"unknown":"unknown";
    const key=origin+":"+r.DESTINATION_ID;if((out.get(key)?.at??"")>at)continue;
    out.set(key,{key,origin,start,dest,area:origin.startsWith("H")?"港島":origin.startsWith("K")?"九龍":"新界",status,minutes:timed?Number(r.JOURNEY_DATA):null,at});
  }return [...out.values()];
}
// Only fixed, TD-identified detectors, never a user's whereabouts. Report speed, not an invented congestion class.
export function detectorSpots(input:string):Spot[]{
 if(input.length>2200000||/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(input)||!/<raw_speed_volume_list\b/.test(input)||!/<\/raw_speed_volume_list>\s*$/.test(input))throw Error("invalid detector feed");
 const date=/<date>(\d{4}-\d{2}-\d{2})<\/date>/.exec(input)?.[1],out=new Map<string,Spot>();if(!date)return [];
 for(const p of input.matchAll(/<period>([\s\S]*?)<\/period>/g)){const time=/<period_to>(\d{2}:\d{2}:\d{2})<\/period_to>/.exec(p[1])?.[1],at=time&&hkTimestamp(date+"T"+time);if(!at)continue;
  for(const d of p[1].matchAll(/<detector>([\s\S]*?)<\/detector>/g)){
   const id=/<detector_id>([A-Z0-9]+)<\/detector_id>/.exec(d[1])?.[1];if(!id||!Object.hasOwn(detectorNames,id)||(out.get(id)?.at??"")>=at)continue;
   let weighted=0,count=0;for(const l of d[1].matchAll(/<lane>([\s\S]*?)<\/lane>/g)){if(!/<valid>Y<\/valid>/i.test(l[1]))continue;
    const s=/<speed>(\d+(?:\.\d+)?)<\/speed>/.exec(l[1]),v=/<volume>(\d+)<\/volume>/.exec(l[1]);if(!s||!v||+v[1]<=0||+s[1]>160)continue;weighted+=+s[1]*+v[1];count+=+v[1];}
   if(count)out.set(id,{id,label:detectorNames[id as keyof typeof detectorNames],at,kph:Math.round(weighted/count)});
  }
 }return [...out.values()];
}
export function notices(data:string):RoadNotice[]{
  const latest=new Map<string,Record<string,string>>();
  for(const n of records(data,"list","message")){const id=n.INCIDENT_NUMBER||n.ID,at=hkTimestamp(n.ANNOUNCEMENT_DATE);if(!id||!at)continue;if((latest.get(id)?.at??"")<=at)latest.set(id,{...n,at});}
  return [...latest.values()].filter(n=>["NEW","UPDATED"].includes(n.INCIDENT_STATUS_EN)&&n.CONTENT_CN).map(n=>({id:n.INCIDENT_NUMBER||n.ID,place:n.LOCATION_CN||n.INCIDENT_HEADING_CN,direction:n.DIRECTION_CN,body:n.CONTENT_CN.slice(0,600),at:n.at})).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,12);
}
function csv(input:string){
 const rows:string[][]=[];let row:string[]=[],v="",quoted=false;
 for(let i=0;i<input.length;i++){const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){v+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===","||c==="\n")){row.push(v.trim());v="";if(c==="\n"){rows.push(row);row=[];}}else if(c!=="\r")v+=c;}if(quoted)throw Error("malformed csv");if(v||row.length){row.push(v.trim());rows.push(row);}
 const h=rows.shift()??[];return {h,rows:rows.map(line=>Object.fromEntries(h.map((k,i)=>[k,line[i]??""])) as Record<string,string>)};
}
function day(v:string){const m=/^(\d\d)\/(\d\d)\/(\d{4})(?: |$)/.exec(v??"");return m?m[3]+"-"+m[2]+"-"+m[1]:null;}
export function hkMoment(now:Date){const s=new Date(now.getTime()+8*3600_000);return {date:s.toISOString().slice(0,10),time:s.toISOString().slice(11,19),sunday:s.getUTCDay()===0};}
export function holidayClass(input:unknown,now:Date):"weekday"|"holiday"|"unknown"{
 const {date,sunday}=hkMoment(now);if(sunday)return "holiday";
 const cal=(input as {vcalendar?:Array<{vevent?:Array<{dtstart?:[string,unknown]}>}>}|null)?.vcalendar?.[0]?.vevent;
 const dates=Array.isArray(cal)?cal.map(v=>v.dtstart?.[0]).filter((v):v is string=>typeof v==="string"&&/^\d{8}$/.test(v)):[];
 const compact=date.replaceAll("-","");if(dates.includes(compact))return "holiday";
 // Never assume an unsupported or obviously partial year is an ordinary working day.
 const year=dates.filter(v=>v.startsWith(compact.slice(0,4)));return year.length>=12&&year.some(v=>v.slice(4,6)==="12")?"weekday":"unknown";
}
export function tollRates(input:string,variable:boolean,vehicle:"PC"|"MC",period:"weekday"|"holiday"|"unknown",now:Date):Toll[]{
 const {h,rows}=csv(input.replace(/^\uFEFF/,""));const needed=["TUNNEL_BRIDGE_CHINESE_NAME","EFFECTIVE_DATE","GAZETTED_TOLL","VEHICLE_CLASS_DESCRIPTION",...(variable?["DAY_OF_WEEK","START_TIME","END_TIME"]:["CONCESS_TOLL"])];
 if(!needed.every(c=>h.includes(c)))throw Error("unknown tariff schema");
 const {date,time}=hkMoment(now);if(variable&&period==="unknown")return [];
 const selected=rows.filter(r=>r.VEHICLE_CLASS_DESCRIPTION===vehicle&&r.TUNNEL_BRIDGE_CHINESE_NAME&&!r.TUNNEL_BRIDGE_CHINESE_NAME.includes("備用")&&day(r.EFFECTIVE_DATE)!==null&&day(r.EFFECTIVE_DATE)!<=date);
 const latest=new Map<string,string>();for(const r of selected){const name=r.TUNNEL_BRIDGE_CHINESE_NAME,effective=day(r.EFFECTIVE_DATE)!;if((latest.get(name)??"")<effective)latest.set(name,effective);}
 const out=new Map<string,Toll>(),conflicts=new Set<string>();
 for(const r of selected){const name=r.TUNNEL_BRIDGE_CHINESE_NAME;if(day(r.EFFECTIVE_DATE)!==latest.get(name))continue;
  if(variable&&(r.DAY_OF_WEEK!==(period==="holiday"?"B":"A")||!/^\d\d:\d\d:\d\d$/.test(r.START_TIME)||!/^\d\d:\d\d:\d\d$/.test(r.END_TIME)||r.START_TIME>time||time>r.END_TIME))continue;
  const rate=variable?r.GAZETTED_TOLL:(r.CONCESS_TOLL||r.GAZETTED_TOLL);if(!/^\d+(\.\d{1,2})?$/.test(rate))continue;
  const fee=Number(rate);if(out.has(name)&&out.get(name)!.fee!==fee){conflicts.add(name);continue;}
  const until=variable?new Date(Date.parse(date+"T"+r.END_TIME+"+08:00")+1000).toISOString():null;out.set(name,{name,fee,variable,until,revised:day(r.LAST_UPDATED_DATE)});
 }return [...out.values()].filter(x=>!conflicts.has(x.name));
}
