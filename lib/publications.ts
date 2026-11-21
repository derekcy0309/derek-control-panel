export const series = {
  home: "香港居家及社區護理市場", ngo: "香港 NGO 醫療服務、資助及轉介動向",
  chronic: "全球慢性病治療研究", weekly: "上週醫療及社區護理重點摘要", us: "美股晚報"
} as const;
export type Series = keyof typeof series;
export const isSeries = (s:unknown):s is Series=>typeof s==="string"&&Object.hasOwn(series,s);
export const preferenceNames = {journals:"刊物（醫療期刊及美股晚報）", news:"公開新聞", traffic:"交通路況"} as const;
export type InfoKey=keyof typeof preferenceNames;
export type InfoPrefs=Record<InfoKey,boolean>;
export const off:InfoPrefs={journals:false,news:false,traffic:false};
export const isInfoKey=(s:unknown):s is InfoKey=>typeof s==="string"&&Object.hasOwn(off,s);
export type Block={text:string;heading:boolean;links:{label:string;href:string}[]};
export type Issue={id:string; series:Series;title:string;published:string;from:string;until:string;lead:string;read:boolean;saved:boolean;snippet:string|null;anchor:number|null;version:number};
export type Details=Issue&{blocks:Block[];revision:string;sourceKind:string};
export function safeSource(value:unknown){if(typeof value!=="string"||value.length>2400||!/^(https?):\/\//i.test(value))return null;
  try{const url=new URL(value);return /^(https?:)$/.test(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}}
export function isoDay(v:unknown):v is string {if(typeof v!=="string"||!/^\d{4}-\d\d-\d\d$/.test(v))return false;const t=Date.parse(v+"T00:00:00Z");return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===v;}
export function validBlocks(blocks:unknown):blocks is Block[]{return Array.isArray(blocks)&&blocks.length>0&&blocks.length<=2000&&blocks.every(b=>b&&typeof b.text==="string"&&b.text.trim()&&b.text.length<=30000&&typeof b.heading==="boolean"&&Array.isArray(b.links)&&b.links.every((l:{label?:unknown;href?:unknown})=>l&&typeof l.label==="string"&&safeSource(l.href)));}
