import xml from "xml-js";
import type {Element} from "xml-js";
import type {NewsGroup,NewsSection,Story} from "../briefing.ts";
type Feed={label:string;name:string;rss:string;page:string;hosts:string[];match?:RegExp};
const rthkHosts=["rthk.hk","news.rthk.hk","rthk9.rthk.hk","www.rthk.hk"];
export const feeds:Record<NewsSection,Feed[]>={
  local:[{label:"本地要聞",name:"香港電台",rss:"https://rthk9.rthk.hk/rthk/news/rss/c_expressnews_clocal.xml",page:"https://news.rthk.hk/rthk/ch/latest-news/local.htm",hosts:rthkHosts}],
  markets:[{label:"美股市場",name:"Nasdaq",rss:"https://www.nasdaq.com/feed/rssoutbound?category=Markets",page:"https://www.nasdaq.com/news-and-insights/markets",hosts:["www.nasdaq.com","nasdaq.com"]},
    {label:"港股焦點",name:"香港電台財經",rss:"https://rthk9.rthk.hk/rthk/news/rss/c_expressnews_cfinance.xml",page:"https://news.rthk.hk/rthk/ch/latest-news/finance.htm",hosts:rthkHosts,match:/港股|恒指|恆指|恒生|恆生|港交所|港股通|國指|本港股市|在港上市|聯交所|恒科指|科指/i}],
  care:[{label:"社福界及社區照顧動向",name:"香港社會服務聯會",rss:"https://www.hkcss.org.hk/feed/",page:"https://www.hkcss.org.hk/",hosts:["www.hkcss.org.hk","hkcss.org.hk"],match:/社區照顧|居家|家居照顧|護理|上門|照顧券|長者|長期照顧|離院|出院|照顧者|CCSV|elderly|community care|home care/i}],
  gadgets:[{label:"Apple · 手機及平板",name:"Apple 香港 Newsroom",rss:"https://www.apple.com/hk/newsroom/rss-feed.rss",page:"https://www.apple.com/hk/newsroom/",hosts:["www.apple.com","apple.com"],match:/iphone|ipad|手機|平板|ios|ipados/i},
    {label:"Android · Galaxy 手機及平板",name:"Samsung Newsroom",rss:"https://news.samsung.com/global/feed",page:"https://news.samsung.com/global/",hosts:["news.samsung.com"],match:/galaxy|smartphone|tablet|foldable|one ui/i}]
};
const maximum=700_000;
const children=(el:Element|undefined,name:string)=>el?.elements?.filter(x=>x.type==="element"&&x.name===name)??[];
const plain=(el:Element|undefined)=>el?.elements?.map(v=>String(v.text??v.cdata??"")).join("").replace(/<[^>]{0,500}>/g," ").replace(/\s+/g," ").trim()??"";
function allowed(input:string,hosts:string[],base:string,allowHttp=false){
  try{const u=new URL(input,base);if(allowHttp&&u.protocol==="http:")u.protocol="https:";return u.protocol==="https:"&&hosts.includes(u.hostname)&&!u.username&&!u.password&&!u.port?u:null;}catch{return null;}
}
/** Only publisher-supplied headlines; never render feed HTML or request an article URL. */
export function readStories(source:Feed,body:string):Story[]{
  if(!body.trim()||body.length>maximum||/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(body))throw Error("Invalid feed");
  const root=(xml.xml2js(body,{compact:false,ignoreComment:true,ignoreInstruction:true}) as Element).elements?.find(x=>x.type==="element");
  const rss=root?.name==="rss",atom=root?.name==="feed";
  if(!rss&&!atom)throw Error("Not a feed");
  const entries=rss?children(children(root,"channel")[0],"item"):children(root,"entry");
  const unique=new Set<string>(),out:Story[]=[];
  for(const it of entries.slice(0,140)){
    const title=plain(children(it,"title")[0]).slice(0,280);if(!title||source.match&&!source.match.test(title))continue;
    const links=children(it,"link");const address=atom?String(links.find(x=>!x.attributes?.rel||x.attributes.rel==="alternate")?.attributes?.href??""):plain(links[0])||plain(children(it,"guid")[0]);
    if(!address)continue;const url=allowed(address,source.hosts,source.page,true);if(!url||unique.has(url.href))continue;
    const rawDate=plain(children(it,rss?"pubDate":"updated")[0])||plain(children(it,"published")[0]);
    const ms=Date.parse(rawDate);unique.add(url.href);out.push({title,url:url.href,date:Number.isFinite(ms)?new Date(ms).toISOString():null,source:source.name});
  }
  return out.sort((a,b)=>(b.date??"").localeCompare(a.date??"")).slice(0,5);
}
async function download(f:Feed){
  let url=new URL(f.rss);const signal=AbortSignal.timeout(8000);
  for(let i=0;i<4;i++){
    const res=await fetch(url,{redirect:"manual",credentials:"omit",signal,next:{revalidate:900}});
    if([301,302,303,307,308].includes(res.status)){
      const loc=res.headers.get("location"),next=loc&&allowed(loc,f.hosts,url.href);await res.body?.cancel();
      if(!next)throw Error("Invalid redirect");url=next;continue;
    }
    if(!res.ok||!res.body||Number(res.headers.get("content-length")||0)>maximum){await res.body?.cancel();throw Error("Unavailable");}
    const reader=res.body.getReader(),decoder=new TextDecoder();let size=0,body="";
    try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>maximum){await reader.cancel();throw Error("Too large");}body+=decoder.decode(x.value,{stream:true});}}finally{reader.releaseLock();}
    return readStories(f,body+decoder.decode());
  }throw Error("Too many redirects");
}
export async function getNewsGroups(section:NewsSection):Promise<NewsGroup[]>{
  return Promise.all(feeds[section].map(async f=>{const info={label:f.label,source:f.name,sourceUrl:f.page};try{return {...info,stories:await download(f),state:"ok" as const};}catch{return {...info,stories:[],state:"unavailable" as const};}}));
}
