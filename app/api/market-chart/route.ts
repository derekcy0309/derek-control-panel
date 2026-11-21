import {marketIndices} from "@/lib/briefing";
export const dynamic="force-dynamic";
/** Redirect to the provider's own origin. No third-party code executes on the Panel origin. */
export function GET(req:Request){
  const q=new URL(req.url).searchParams,i=q.get("index");
  if(i===null||!/^\d$/.test(i)||!marketIndices[Number(i)]||[...q.keys()].some(k=>k!=="index"))return new Response("Unknown index",{status:400});
  const s=marketIndices[Number(i)];
  const config={symbols:[[s.label,s.symbol+"|1D"]],chartOnly:false,width:"100%",height:"100%",colorTheme:"light",isTransparent:false,showVolume:false,showMA:false,hideDateRanges:false,hideMarketStatus:false,scaleMode:"Normal",scalePosition:"right",chartType:"area",dateRanges:["1m|1D","3m|1D","12m|1D","60m|1W","all|1M"]};
  const location="https://www.tradingview-widget.com/embed-widget/symbol-overview/?locale=zh_TW#"+encodeURIComponent(JSON.stringify(config));
  return new Response(null,{status:302,headers:{Location:location,"Cache-Control":"public, max-age=3600","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});
}
