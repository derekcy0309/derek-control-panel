export type LinkShelf = "site" | "later";
export type HomeLink = { id: string; title: string; url: string; shelf: LinkShelf };
// Public shortcuts, not pre-written bookmarks. No account-specific URL or tracking pixel.
export const usefulLinks=[
  {title:"香港出行易",url:"https://www.hkemobility.gov.hk/tc/"},
  {title:"即時隧道費",url:"https://www.hkemobility.gov.hk/tc/toll-rate/"},
  {title:"香港天文台",url:"https://www.hko.gov.hk/tc/index.html"},
  {title:"Google Calendar",url:"https://calendar.google.com/"},
  {title:"社署 CCSV 照顧券",url:"https://www.swd.gov.hk/tc/pubsvc/elderly/cat_commcare/psccsv/index.html"}
] as const;
export function websiteAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s=raw.trim();
  if(!s||s.length>1800||/[\s\\\u0000-\u001f]/.test(s)||s.startsWith("//"))return null;
  try {
    const u=new URL(/^[a-z][\w+.-]*:/i.test(s)?s:"https://"+s);
    if(!["https:","http:"].includes(u.protocol)||u.username||u.password||!u.hostname.includes("."))return null;
    return u.href;
  }catch{return null;}
}
export function homeLink(row:{id:unknown;title:unknown;description:unknown;metadata:unknown}):HomeLink|null{
  if(typeof row.id!=="string"||typeof row.title!=="string"||!row.metadata||typeof row.metadata!=="object")return null;
  const shelf=(row.metadata as Record<string,unknown>).daylineShelf;
  const url=websiteAddress(row.description);
  return url&&(shelf==="site"||shelf==="later")?{id:row.id,title:row.title,url,shelf}:null;
}
