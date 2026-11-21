import {createHash} from "node:crypto";
import xml from "xml-js";
import {isSeries,isoDay,safeSource,validBlocks,type Block} from "../publications.ts";
type Xml={type?:string;name?:string;text?:string;attributes?:Record<string,unknown>;elements?:Xml[]};
function htmlBlocks(raw:string):Block[]{
  if(/<!DOCTYPE|<!ENTITY/i.test(raw))throw Error("不支援呢種 HTML。");
  const tree=xml.xml2js(raw.replace(/&nbsp;/g,"&#160;").replace(/<br\s*>/gi,"<br/>"),{compact:false,captureSpacesBetweenElements:true}) as Xml;
  const blocks:Block[]=[];let b:Block={text:"",heading:false,links:[]};
  const flush=()=>{if(b.text.trim())blocks.push({...b,text:b.text.trim()});b={text:"",heading:false,links:[]};};
  function visit(n:Xml){if(n.type==="text"){b.text+=n.text??"";return;}const name=(n.name||"").toLowerCase();
    if(["script","style","img","iframe","object","svg","head","form","template","noscript"].includes(name))return;
    if(name==="br"){b.text+="\n";return;}
    const line=/^(p|h[1-6]|li|tr|div|section|blockquote)$/.test(name);if(line){flush();b.heading=/^h[1-6]$/.test(name);}
    const start=b.text.length;for(const c of n.elements??[])visit(c);
    if(name==="a"){const href=safeSource(n.attributes?.href);if(href)b.links.push({label:b.text.slice(start).trim()||href,href});}
    if(line)flush();
  }visit(tree);flush();return blocks;
}
function markdownBlocks(raw:string):Block[]{return raw.trim().split(/\r?\n\s*\r?\n/).flatMap(part=>{
  const links:Block["links"]=[];let text=part.trim().replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+(?:\([^\s()]*\)[^\s)]*)?)\)/gi,(_,label:string,url:string)=>{const href=safeSource(url);if(href)links.push({label,href});return label;});
  for(const match of text.matchAll(/https?:\/\/[^\s<>]+/gi)){const href=safeSource(match[0].replace(/[.,;。；]+$/u,""));if(href&&!links.some(l=>l.href===href))links.push({label:href,href});}
  const heading=/^#{1,6}\s/.test(text);text=text.replace(/^#{1,6}\s/,"").replace(/\*\*([^*]+)\*\*/g,"$1");
  return text?[{text,heading,links}]:[];});}
export function preparePublication(input:unknown){
  if(!input||typeof input!=="object"||Array.isArray(input))throw Error("刊物格式有誤。");
  const v=input as Record<string,unknown>;const {series,title,published,from,until,format,original,sourceRef,sourceKind}=v;
  if(!isSeries(series)||typeof title!=="string"||!title.trim()||title.length>350||!isoDay(published)||!isoDay(from)||!isoDay(until)||from>until||
    (format!=="html"&&format!=="markdown")||typeof original!=="string"||!original.trim()||Buffer.byteLength(original)>400000||
    typeof sourceRef!=="string"||!sourceRef.trim()||sourceRef.length>200||!["email-seed","codex-trial","codex-scheduled"].includes(String(sourceKind)))throw Error("請提供出刊及涵蓋日期、完整原文和來源。");
  const blocks=format==="html"?htmlBlocks(original):markdownBlocks(original);
  if(!validBlocks(blocks))throw Error("未能完整讀取內文，未有匯入。");
  const lead=typeof v.lead==="string"?v.lead.trim():"";
  if(!lead||lead.length>500)throw Error("請附上一句出刊重點。");
  const revision=createHash("sha256").update(JSON.stringify([series,published,from,until,title,lead,format,original])).digest("hex");
  return {series,title:title.trim(),published,from,until,format,original,sourceRef:sourceRef.trim(),sourceKind,blocks,lead,revision};
}
