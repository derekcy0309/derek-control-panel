import type {Journey,Toll} from "./roadwatch.ts";
export const presetNames={r3:"三號幹線（大欖段）",cht:"紅隧過海（來回）","tm-in":"入屯門（屯門公路／元朗公路）","tm-out":"屯門公路・出荃灣",airport:"往機場",eht:"東隧過海（來回）",wht:"西隧過海（來回）",lion:"獅子山隧道往九龍",tate:"大老山隧道往九龍"} as const;
export type Preset=keyof typeof presetNames;
export const defaultRoads:Preset[]=["r3","cht","tm-in","tm-out","airport"];
const members:Record<Preset,string[]>={r3:["SJ4:TKTL","K07:ACTT"],cht:["K04:CH","H2:CH"],"tm-in":[],"tm-out":["SJ5:TWTM"],airport:["N02:TMCLK","K07:ATSCA"],eht:["K02:EH","H1:EH"],wht:["K01:WH","H3:WH"],lion:["SJ1:LRT"],tate:["SJ2:TCT"]};
export type Spot={id:string;label:string;kph:number;at:string};
export const detectorNames={TDS90020:"屯門公路・汀九西行入屯門",TDS90016:"屯門公路・荃灣路交界西行",TDS91044:"元朗公路・洪天路西行往屯門",AID05201:"屯門公路・麗城花園東行出荃灣"} as const;
export function validRoads(v:unknown):v is string[]{return Array.isArray(v)&&v.length<=24&&new Set(v).size===v.length&&v.every(s=>typeof s==="string"&&(Object.hasOwn(presetNames,s)||/^(H\d{1,2}|K\d{2}|N\d{2}|SJ\d):[A-Z]{2,5}$/.test(s)));}
export function watchGroup(key:string,journeys:Journey[],spots:Spot[]){
 const known=Object.hasOwn(presetNames,key),wanted=known?members[key as Preset]:[key];
 const matches=wanted.flatMap(id=>journeys.filter(x=>x.key===id));
 return {label:known?presetNames[key as Preset]:matches[0]?matches[0].start+" → "+matches[0].dest:"自選路段 "+key,roads:matches,
   spots:(key==="tm-in"?["TDS90020","TDS91044","TDS90016"]:key==="tm-out"?["AID05201"]:[]).flatMap(id=>spots.filter(x=>x.id===id))};
}
export const primaryTolls=[["海底隧道","紅隧"],["東區海底隧道","東隧"],["西區海底隧道","西隧"],["大欖隧道","大欖隧道"]] as const;
export function tollBoard(tolls:Toll[],now:number,valid:boolean){return primaryTolls.map(([name,label])=>({name,label,fee:valid?tolls.find(t=>t.name===name&&t.variable&&t.until&&Date.parse(t.until)>now)?.fee??null:null}));}
