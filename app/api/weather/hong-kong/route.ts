import { hkWeather } from "@/lib/dayline-weather";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const source="https://data.weather.gov.hk/weatherAPI/opendata/weather.php";
async function feed(type:"rhrread"|"fnd"|"warnsum") {
  try {
    const response=await fetch(source+"?dataType="+type+"&lang=tc",{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(6500)});
    return response.ok ? await response.json() as unknown : null;
  } catch {return null;}
}
// Fixed public feeds only. Never forward request headers, cookies, location or account data.
export async function GET(request: Request) {
  if(new URL(request.url).search) return Response.json({error:"不接受自訂地點或其他參數。"},{status:400,headers:{"Cache-Control":"no-store"}});
  const [current,forecast,warning]=await Promise.all([feed("rhrread"),feed("fnd"),feed("warnsum")]);
  const data=hkWeather(current,forecast,warning);
  const ok=Boolean(data.observed||data.forecast.length||data.warnings!==null);
  return Response.json(data,{status:ok?200:503,headers:{"Cache-Control":ok?"public, max-age=0, s-maxage=60, must-revalidate":"no-store"}});
}
