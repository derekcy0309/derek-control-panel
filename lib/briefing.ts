export const sections={markets:"美股・港股",care:"居家護理市場",local:"香港新聞",gadgets:"手機・Tablet"} as const;
export type NewsSection=keyof typeof sections;
export const isNewsSection=(v:string):v is NewsSection=>Object.prototype.hasOwnProperty.call(sections,v);
export type Story={title:string;url:string;date:string|null;source:string};
export type NewsGroup={label:string;source:string;sourceUrl:string;stories:Story[];state:"ok"|"unavailable"};
export type NewsIssue={section:NewsSection;checkedAt:string;groups:NewsGroup[]};
/** One headline per market, from its last 36-hour publishing window; never infer index movement from a headline. */
export function marketBrief(groups:NewsGroup[],now:Date):Array<{market:string;story:Story}>{
  return groups.flatMap(g=>{
    const candidates=g.stories.flatMap(story=>{const t=Date.parse(story.date??"");return Number.isFinite(t)&&t<=now.getTime()+300_000&&now.getTime()-t<=7*86400_000?[{story,t}]:[];});
    const newest=Math.max(...candidates.map(x=>x.t));
    const rank=(s:string)=>/恒指|恆指|恒生指數|納指|道指|標普|market (today|close|wrap)|stock market|s&p 500|nasdaq composite|dow jones/i.test(s)?2:/\b(?:AI|IPO|healthcare|semiconductor)\b|人工智能|醫療|上市/i.test(s)?1:0;
    const picked=candidates.filter(x=>newest-x.t<=36*3600_000).sort((a,b)=>rank(b.story.title)-rank(a.story.title)||b.t-a.t)[0];return picked?[{market:g.label,story:picked.story}]:[];
  });
}
export const marketIndices=[
  {label:"恒生指數",symbol:"HSI:HSI",path:"HSI-HSI"},{label:"恒生科技",symbol:"HSI:HSTECH",path:"HSI-HSTECH"},
  {label:"標普 500",symbol:"SP:SPX",path:"SP-SPX"},{label:"納斯達克綜合",symbol:"NASDAQ:IXIC",path:"NASDAQ-IXIC"},
  {label:"道瓊斯",symbol:"DJ:DJI",path:"DJ-DJI"},{label:"日經 225",symbol:"TVC:NI225",path:"TVC-NI225"}
] as const;
