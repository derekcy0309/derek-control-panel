export type EncouragementTheme = "gentle" | "action" | "resilience" | "business";
export type EncouragementIntensity = "gentle" | "balanced" | "strong";

export type Encouragement = {
  id: string;
  zh: string;
  en: string;
  author: string;
  authorZh: string;
  citation: string;
  sourceUrl: string;
  theme: EncouragementTheme;
  intensity: EncouragementIntensity;
};

const sources = {
  churchillBeaches: ["〈We Shall Fight on the Beaches〉，1940", "https://winstonchurchill.org/resources/speeches/1940-the-finest-hour/we-shall-fight-on-the-beaches/"],
  churchillHarrow: ["Harrow School 演說，1941", "https://winstonchurchill.org/resources/speeches/1941-1945-war-leader/never-give-in/"],
  lincolnNotes: ["〈Notes for a Law Lecture〉，約1850", "https://presidentlincoln.illinois.gov/lincoln-quotes?pg=14&sz=10"],
  lincolnGettysburg: ["〈Gettysburg Address〉，1863", "https://www.loc.gov/item/today-in-history/november-19/"],
  lincolnAnnual: ["第二次年度國情咨文，1862", "https://www.archives.gov/legislative/features/sotu/lincoln.html"],
  lincolnInaugural: ["第二次就職演說，1865", "https://www.loc.gov/resource/mal.4361300/?st=text"],
  trArena: ["〈Citizenship in a Republic〉，1910", "https://www.theodoreroosevelt.org/content.aspx?club_id=991271&module_id=339335&page_id=22"],
  trStrenuous: ["〈The Strenuous Life〉，1899", "https://www.theodoreroosevelt.org/content.aspx?club_id=991271&module_id=339361&page_id=22"],
  fdrInaugural: ["第一次就職演說，1933", "https://www.presidency.ucsb.edu/documents/inaugural-address-8"],
  fdrOglethorpe: ["Oglethorpe University 演說，1932", "https://www.presidency.ucsb.edu/documents/address-oglethorpe-university-atlanta-georgia"],
  fdrJefferson: ["未發表的 Jefferson Day 講辭，1945", "https://www.presidency.ucsb.edu/documents/undelivered-address-prepared-for-jefferson-day"],
  jfkMoon: ["Rice University 演說，1962", "https://www.jfklibrary.org/archives/other-resources/john-f-kennedy-speeches/rice-university-19620912"],
  jfkPeace: ["American University 演說，1963", "https://www.jfklibrary.org/learn/about-jfk/life-of-john-f-kennedy/john-f-kennedy-quotations"],
  jfkRoof: ["致國會函件，1962", "https://www.presidency.ucsb.edu/documents/letter-the-president-the-senate-and-the-speaker-the-house-transmitting-proposed-stand"],
  jfkDallas: ["原定 Dallas Trade Mart 講辭，1963", "https://www.presidency.ucsb.edu/documents/remarks-prepared-for-delivery-the-trade-mart-dallas"],
  mlkStrength: ["《Strength to Love》，1963", "https://kinginstitute.stanford.edu/nonviolence"],
  mlkWhere: ["〈Where Do We Go from Here?〉，1967", "https://kinginstitute.stanford.edu/where-do-we-go-here"],
  mlkNaacp: ["NAACP Freedom Fund Dinner 演說，1962", "https://kinginstitute.stanford.edu/king-papers/documents/address-delivered-freedom-fund-dinner-fifty-third-annual-convention-naacp"],
  mlkMountain: ["〈Keep Moving from This Mountain〉，1960", "https://kinginstitute.stanford.edu/king-papers/documents/keep-moving-mountain-address-spelman-college-10-april-1960"],
  mandelaLeadership: ["《Long Walk to Freedom》，1994", "https://www.nelsonmandela.org/news/entry/head-and-heart-the-lessons-of-leadership-from-nelson-mandela"],
  mandelaLinger: ["《Long Walk to Freedom》，1994", "https://www.nelsonmandela.org/publications/entry/dare-not-linger"],
  mandelaLove: ["《Long Walk to Freedom》，1994", "https://www.nelsonmandela.org/news/entry/nelson-mandela-annual-lecture-2018-obamas-full-speech"],
  helenOptimism: ["《Optimism》，1903", "https://www.afb.org/about-afb/history/helen-keller/books-essays-speeches/optimism-1903"],
  rowlingHarvard: ["Harvard 畢業演說，2008", "https://news.harvard.edu/gazette/story/2008/06/text-of-j-k-rowling-speech/"],
  malalaNobel: ["諾貝爾和平獎演說，2014", "https://www.nobelprize.org/prizes/peace/2014/yousafzai/lecture/"],
  obamaRutgers: ["Rutgers University 畢業演說，2016", "https://obamawhitehouse.archives.gov/the-press-office/2016/05/15/remarks-president-commencement-address-rutgers-state-university-new/"],
  obamaHoward: ["Howard University 畢業演說，2016", "https://obamawhitehouse.archives.gov/the-press-office/2016/05/07/remarks-president-howard-university-commencement-ceremony/"],
  obamaUk: ["Young Leaders UK Town Hall，2016", "https://www.presidency.ucsb.edu/documents/remarks-and-question-and-answer-session-young-leaders-the-united-kingdom-town-hall-meeting"],
  amazon1997: ["Amazon Shareholder Letter，1997", "https://www.aboutamazon.com/news/company-news/amazons-original-1997-letter-to-shareholders"],
  amazon2016: ["Amazon Shareholder Letter，2016", "https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders"],
  amazon2025: ["Amazon Shareholder Letter，2025", "https://www.aboutamazon.com/news/company-news/amazon-ceo-andy-jassy-2025-letter-to-shareholders"],
  buffett2010: ["致 Berkshire 管理層備忘錄，2010", "https://www.berkshirehathaway.com/2010ar/2010ar.pdf"],
  buffett2024: ["Berkshire Hathaway Shareholder Letter，2024", "https://www.berkshirehathaway.com/letters/2024ltr.pdf"],
  jobsStanford: ["Stanford 畢業演說，2005", "https://news.stanford.edu/stories/2005/06/youve-got-find-love-jobs-says"],
  gatesHarvard: ["Harvard 畢業演說，2007", "https://www.gatesfoundation.org/ideas/speeches/2007/06/bill-gates-harvard-commencement"],
  satyaFirstDay: ["Microsoft 員工信，2014", "https://news.microsoft.com/source/2014/02/04/satya-nadella-email-to-employees-on-first-day-as-ceo/"],
  satyaCulture: ["Microsoft 員工信，2014", "https://news.microsoft.com/source/2014/07/17/starting-to-evolve-our-organization-and-culture/"],
  walmartRules: ["〈10 Rules for Building a Better Business〉", "https://corporate.walmart.com/about/sam-walton/10-rules-for-building-a-better-business"],
  knightInterview: ["Stanford GSB 訪談，2017", "https://www.gsb.stanford.edu/insights/philip-knight-entrepreneur-every-day-crisis"],
  knightCommencement: ["Stanford GSB 畢業演說，2014", "https://www.gsb.stanford.edu/experience/news-history/when-speakers-talk-stanford-gsb-listens"],
  nooyiWake: ["Wake Forest University 畢業演說，2011", "https://commencement.news.wfu.edu/2010s/c2011/2011-speaker-indra-k-nooyi/"],
} as const;

type SourceKey = keyof typeof sources;
type RawQuote = Omit<Encouragement, "citation" | "sourceUrl"> & { source: SourceKey };

const rawQuotes: RawQuote[] = [
  { id: "04", zh: "我們不會氣餒，也不會失敗。", en: "We shall not flag or fail.", author: "Winston Churchill", authorZh: "溫斯頓・邱吉爾", source: "churchillBeaches", theme: "resilience", intensity: "strong" },
  { id: "05", zh: "我們會堅持到底。", en: "We shall go on to the end.", author: "Winston Churchill", authorZh: "溫斯頓・邱吉爾", source: "churchillBeaches", theme: "resilience", intensity: "strong" },
  { id: "06", zh: "我們永不投降。", en: "We shall never surrender.", author: "Winston Churchill", authorZh: "溫斯頓・邱吉爾", source: "churchillBeaches", theme: "resilience", intensity: "strong" },
  { id: "09", zh: "永不屈服——永不、永不、永不、永不。", en: "Never give in—never, never, never, never.", author: "Winston Churchill", authorZh: "溫斯頓・邱吉爾", source: "churchillHarrow", theme: "resilience", intensity: "strong" },
  { id: "12", zh: "你自己成功的決心，比任何一件事都重要。", en: "Your own resolution to succeed is more important than any other one thing.", author: "Abraham Lincoln", authorZh: "亞伯拉罕・林肯", source: "lincolnNotes", theme: "resilience", intensity: "balanced" },
  { id: "13", zh: "今日能做的事，不要留到明日。", en: "Leave nothing for tomorrow which can be done today.", author: "Abraham Lincoln", authorZh: "亞伯拉罕・林肯", source: "lincolnNotes", theme: "action", intensity: "strong" },
  { id: "15", zh: "未完成的工作，應由仍然活着的我們繼續承擔。", en: "It is for us the living…to be dedicated here to the unfinished work.", author: "Abraham Lincoln", authorZh: "亞伯拉罕・林肯", source: "lincolnGettysburg", theme: "resilience", intensity: "balanced" },
  { id: "17", zh: "我們必須迎難而上。", en: "We must rise with the occasion.", author: "Abraham Lincoln", authorZh: "亞伯拉罕・林肯", source: "lincolnAnnual", theme: "action", intensity: "strong" },
  { id: "18", zh: "我們必須重新思考，重新行動。", en: "We must think anew and act anew.", author: "Abraham Lincoln", authorZh: "亞伯拉罕・林肯", source: "lincolnAnnual", theme: "action", intensity: "balanced" },
  { id: "20", zh: "讓我們繼續努力，完成眼前的工作。", en: "Let us strive on to finish the work we are in.", author: "Abraham Lincoln", authorZh: "亞伯拉罕・林肯", source: "lincolnInaugural", theme: "action", intensity: "balanced" },
  { id: "21", zh: "真正重要的，不是批評者。", en: "It is not the critic who counts.", author: "Theodore Roosevelt", authorZh: "西奧多・羅斯福", source: "trArena", theme: "resilience", intensity: "balanced" },
  { id: "22", zh: "榮譽屬於真正身在競技場上的人。", en: "The credit belongs to the man who is actually in the arena.", author: "Theodore Roosevelt", authorZh: "西奧多・羅斯福", source: "trArena", theme: "resilience", intensity: "balanced" },
  { id: "24", zh: "他會犯錯，也會一次又一次未能達標。", en: "Who errs, who comes short again and again.", author: "Theodore Roosevelt", authorZh: "西奧多・羅斯福", source: "trArena", theme: "gentle", intensity: "gentle" },
  { id: "25", zh: "即使失敗，至少也是在勇敢嘗試中失敗。", en: "If he fails, at least fails while daring greatly.", author: "Theodore Roosevelt", authorZh: "西奧多・羅斯福", source: "trArena", theme: "resilience", intensity: "balanced" },
  { id: "26", zh: "勇於挑戰偉大的事，遠勝於安於平凡。", en: "Far better it is to dare mighty things.", author: "Theodore Roosevelt", authorZh: "西奧多・羅斯福", source: "trStrenuous", theme: "resilience", intensity: "strong" },
  { id: "31", zh: "我們唯一需要恐懼的，就是恐懼本身。", en: "The only thing we have to fear is fear itself.", author: "Franklin D. Roosevelt", authorZh: "富蘭克林・D・羅斯福", source: "fdrInaugural", theme: "resilience", intensity: "balanced" },
  { id: "32", zh: "這個國家要求行動，而且要立即行動。", en: "This Nation asks for action, and action now.", author: "Franklin D. Roosevelt", authorZh: "富蘭克林・D・羅斯福", source: "fdrInaugural", theme: "action", intensity: "strong" },
  { id: "33", zh: "我們需要大膽而持續的試驗。", en: "The country demands bold, persistent experimentation.", author: "Franklin D. Roosevelt", authorZh: "富蘭克林・D・羅斯福", source: "fdrOglethorpe", theme: "business", intensity: "balanced" },
  { id: "34", zh: "選一個方法，然後試。", en: "Take a method and try it.", author: "Franklin D. Roosevelt", authorZh: "富蘭克林・D・羅斯福", source: "fdrOglethorpe", theme: "action", intensity: "balanced" },
  { id: "35", zh: "如果失敗，就坦白承認，再試另一個方法。", en: "If it fails, admit it frankly and try another.", author: "Franklin D. Roosevelt", authorZh: "富蘭克林・D・羅斯福", source: "fdrOglethorpe", theme: "action", intensity: "balanced" },
  { id: "36", zh: "但最重要的是：一定要嘗試。", en: "But above all, try something.", author: "Franklin D. Roosevelt", authorZh: "富蘭克林・D・羅斯福", source: "fdrOglethorpe", theme: "action", intensity: "balanced" },
  { id: "37", zh: "我們需要熱誠、想像力，以及面對事實的能力。", en: "We need enthusiasm, imagination and the ability to face facts.", author: "Franklin D. Roosevelt", authorZh: "富蘭克林・D・羅斯福", source: "fdrOglethorpe", theme: "business", intensity: "balanced" },
  { id: "38", zh: "人並非命運的囚徒，只是自己思想的囚徒。", en: "Men are not prisoners of fate, but only prisoners of their own minds.", author: "Franklin D. Roosevelt", authorZh: "富蘭克林・D・羅斯福", source: "fdrJefferson", theme: "resilience", intensity: "balanced" },
  { id: "40", zh: "讓我們懷着堅定而積極的信念向前。", en: "Let us move forward with strong and active faith.", author: "Franklin D. Roosevelt", authorZh: "富蘭克林・D・羅斯福", source: "fdrJefferson", theme: "gentle", intensity: "gentle" },
  { id: "46", zh: "不是因為事情容易，而是因為它們艱難。", en: "Not because they are easy, but because they are hard.", author: "John F. Kennedy", authorZh: "約翰・F・甘迺迪", source: "jfkMoon", theme: "resilience", intensity: "strong" },
  { id: "48", zh: "我們的問題由人造成，因此也能由人解決。", en: "Our problems are man-made; therefore, they can be solved by man.", author: "John F. Kennedy", authorZh: "約翰・F・甘迺迪", source: "jfkPeace", theme: "action", intensity: "balanced" },
  { id: "49", zh: "修理屋頂的時候，是陽光仍然普照之時。", en: "The time to repair the roof is when the sun is shining.", author: "John F. Kennedy", authorZh: "約翰・F・甘迺迪", source: "jfkRoof", theme: "business", intensity: "balanced" },
  { id: "50", zh: "領導與學習，彼此不可或缺。", en: "Leadership and learning are indispensable to each other.", author: "John F. Kennedy", authorZh: "約翰・F・甘迺迪", source: "jfkDallas", theme: "business", intensity: "balanced" },
  { id: "51", zh: "黑暗不能驅走黑暗；只有光可以。", en: "Darkness cannot drive out darkness; only light can do that.", author: "Martin Luther King Jr.", authorZh: "馬丁・路德・金", source: "mlkStrength", theme: "gentle", intensity: "gentle" },
  { id: "52", zh: "仇恨不能驅走仇恨；只有愛可以。", en: "Hate cannot drive out hate; only love can do that.", author: "Martin Luther King Jr.", authorZh: "馬丁・路德・金", source: "mlkStrength", theme: "gentle", intensity: "gentle" },
  { id: "53", zh: "我已決定堅持選擇愛。", en: "I have decided to stick with love.", author: "Martin Luther King Jr.", authorZh: "馬丁・路德・金", source: "mlkWhere", theme: "gentle", intensity: "gentle" },
  { id: "55", zh: "我們必須繼續前進。", en: "We must keep moving.", author: "Martin Luther King Jr.", authorZh: "馬丁・路德・金", source: "mlkNaacp", theme: "resilience", intensity: "balanced" },
  { id: "56", zh: "做正確的事，任何時候都是合適的時候。", en: "The time is always right to do right.", author: "Martin Luther King Jr.", authorZh: "馬丁・路德・金", source: "mlkNaacp", theme: "action", intensity: "balanced" },
  { id: "57", zh: "繼續向前。", en: "Keep moving.", author: "Martin Luther King Jr.", authorZh: "馬丁・路德・金", source: "mlkMountain", theme: "resilience", intensity: "balanced" },
  { id: "59", zh: "如果不能飛，就跑；如果不能跑，就走。", en: "If you can’t fly, run; if you can’t run, walk.", author: "Martin Luther King Jr.", authorZh: "馬丁・路德・金", source: "mlkMountain", theme: "gentle", intensity: "gentle" },
  { id: "60", zh: "無論如何，都要繼續前進。", en: "By all means keep moving.", author: "Martin Luther King Jr.", authorZh: "馬丁・路德・金", source: "mlkMountain", theme: "resilience", intensity: "balanced" },
  { id: "61", zh: "勇氣不是沒有恐懼，而是戰勝恐懼。", en: "Courage was not the absence of fear, but the triumph over it.", author: "Nelson Mandela", authorZh: "納爾遜・曼德拉", source: "mandelaLeadership", theme: "resilience", intensity: "balanced" },
  { id: "63", zh: "攀過一座高山後，才發現還有更多山峰要跨越。", en: "After climbing a great hill, one only finds that there are many more hills to climb.", author: "Nelson Mandela", authorZh: "納爾遜・曼德拉", source: "mandelaLinger", theme: "gentle", intensity: "gentle" },
  { id: "64", zh: "我只是在這裏稍作休息。", en: "I have taken a moment here to rest.", author: "Nelson Mandela", authorZh: "納爾遜・曼德拉", source: "mandelaLinger", theme: "gentle", intensity: "gentle" },
  { id: "66", zh: "我不敢停留，因為漫長的路仍未走完。", en: "I dare not linger, for my long walk is not ended.", author: "Nelson Mandela", authorZh: "納爾遜・曼德拉", source: "mandelaLinger", theme: "resilience", intensity: "strong" },
  { id: "69", zh: "既然人能學會憎恨，也就能被教導去愛。", en: "If they can learn to hate, they can be taught to love.", author: "Nelson Mandela", authorZh: "納爾遜・曼德拉", source: "mandelaLove", theme: "gentle", intensity: "gentle" },
  { id: "74", zh: "世界雖充滿苦難，也充滿戰勝苦難的力量。", en: "Although the world is full of suffering, it is full also of the overcoming of it.", author: "Helen Keller", authorZh: "海倫・凱勒", source: "helenOptimism", theme: "gentle", intensity: "gentle" },
  { id: "76", zh: "沒有人能說服我接受絕望。", en: "I never can be argued into hopelessness.", author: "Helen Keller", authorZh: "海倫・凱勒", source: "helenOptimism", theme: "resilience", intensity: "balanced" },
  { id: "77", zh: "願意工作並付諸行動，本身就是樂觀。", en: "The desire and will to work is optimism itself.", author: "Helen Keller", authorZh: "海倫・凱勒", source: "helenOptimism", theme: "action", intensity: "balanced" },
  { id: "79", zh: "每一次進度停頓，都可能只是大步躍進前的暫停。", en: "Each halt in his progress has been but a pause before a mighty leap forward.", author: "Helen Keller", authorZh: "海倫・凱勒", source: "helenOptimism", theme: "gentle", intensity: "gentle" },
  { id: "86", zh: "人生低谷成了我重建生命的穩固地基。", en: "Rock bottom became the solid foundation on which I rebuilt my life.", author: "J. K. Rowling", authorZh: "J・K・羅琳", source: "rowlingHarvard", theme: "gentle", intensity: "gentle" },
  { id: "90", zh: "我們必須行動，而不是等待。", en: "We must work… not wait.", author: "Malala Yousafzai", authorZh: "馬拉拉・優素福扎伊", source: "malalaNobel", theme: "action", intensity: "balanced" },
  { id: "93", zh: "有改善，就是好事。", en: "Better is good.", author: "Barack Obama", authorZh: "巴拉克・奧巴馬", source: "obamaRutgers", theme: "gentle", intensity: "gentle" },
  { id: "97", zh: "熱誠很重要，但你亦必須有策略。", en: "Passion is vital, but you’ve got to have a strategy.", author: "Barack Obama", authorZh: "巴拉克・奧巴馬", source: "obamaHoward", theme: "business", intensity: "balanced" },
  { id: "100", zh: "進步並非必然發生。", en: "Progress is not inevitable.", author: "Barack Obama", authorZh: "巴拉克・奧巴馬", source: "obamaUk", theme: "business", intensity: "balanced" },

  { id: "B01", zh: "我們會繼續從成功與失敗中學習。", en: "We will continue to learn from both our successes and our failures.", author: "Jeff Bezos", authorZh: "謝夫・貝索斯", source: "amazon1997", theme: "business", intensity: "balanced" },
  { id: "B02", zh: "保持 Day 1 心態，需要耐心試驗、接受失敗、播下種子，並保護剛萌芽的成果。", en: "Staying in Day 1 requires you to experiment patiently, accept failures, plant seeds, protect saplings.", author: "Jeff Bezos", authorZh: "謝夫・貝索斯", source: "amazon2016", theme: "business", intensity: "balanced" },
  { id: "B03", zh: "我們不可能完美，但可以努力做得更好。", en: "We can’t be perfect but we can try to be.", author: "Warren Buffett", authorZh: "華倫・巴菲特", source: "buffett2010", theme: "gentle", intensity: "gentle" },
  { id: "B04", zh: "問題不會因為我們希望它消失，就自行消失。", en: "Problems cannot be wished away.", author: "Warren Buffett", authorZh: "華倫・巴菲特", source: "buffett2024", theme: "action", intensity: "balanced" },
  { id: "B05", zh: "人生有時會迎頭給你一記重擊。不要失去信念。", en: "Sometimes life’s gonna hit you in the head with a brick. Don’t lose faith.", author: "Steve Jobs", authorZh: "史提夫・喬布斯", source: "jobsStanford", theme: "gentle", intensity: "gentle" },
  { id: "B06", zh: "最重要的是，永遠不要停止思考與行動。", en: "The crucial thing is to never stop thinking and working.", author: "Bill Gates", authorZh: "比爾・蓋茨", source: "gatesHarvard", theme: "action", intensity: "balanced" },
  { id: "B07", zh: "唯一不能失敗的一次，就是你決定不再嘗試的最後一次。", en: "The only time you must not fail is the last time you try.", author: "Phil Knight", authorZh: "菲爾・奈特", source: "knightInterview", theme: "resilience", intensity: "strong" },
  { id: "B08", zh: "你的每一段經歷，都是一次很好的學習機會。", en: "Every single experience you have is a terrific opportunity to learn.", author: "Indra Nooyi", authorZh: "英德拉・努伊", source: "nooyiWake", theme: "gentle", intensity: "gentle" },
  { id: "B09", zh: "進度會跳躍前進，並非直線。", en: "Progress jumps around.", author: "Andy Jassy", authorZh: "安迪・賈西", source: "amazon2025", theme: "gentle", intensity: "gentle" },
  { id: "B10", zh: "我們會作出大膽的決定，而不是畏縮的決定。", en: "We will make bold rather than timid investment decisions.", author: "Jeff Bezos", authorZh: "謝夫・貝索斯", source: "amazon1997", theme: "business", intensity: "strong" },
  { id: "B11", zh: "流程不是目的；真正的成果才是。", en: "The process is not the thing.", author: "Jeff Bezos", authorZh: "謝夫・貝索斯", source: "amazon2016", theme: "business", intensity: "balanced" },
  { id: "B12", zh: "問題需要行動解決，即使那個行動令人不舒服。", en: "They require action, however uncomfortable that may be.", author: "Warren Buffett", authorZh: "華倫・巴菲特", source: "buffett2024", theme: "action", intensity: "strong" },
  { id: "B13", zh: "繼續尋找，不要將就。", en: "Keep looking—and don’t settle.", author: "Steve Jobs", authorZh: "史提夫・喬布斯", source: "jobsStanford", theme: "action", intensity: "balanced" },
  { id: "B14", zh: "不要讓複雜程度阻止你行動。", en: "Don’t let complexity stop you.", author: "Bill Gates", authorZh: "比爾・蓋茨", source: "gatesHarvard", theme: "action", intensity: "balanced" },
  { id: "B15", zh: "有清晰焦點只是旅程的開始，不是終點。", en: "Having a clear focus is the start of the journey, not the end.", author: "Satya Nadella", authorZh: "薩提亞・納德拉", source: "satyaCulture", theme: "business", intensity: "balanced" },
  { id: "B16", zh: "要敢於冒險，否則你的才能可能永遠埋在地下。", en: "Dare to take chances, lest you leave your talent buried in the ground.", author: "Phil Knight", authorZh: "菲爾・奈特", source: "knightCommencement", theme: "action", intensity: "strong" },
  { id: "B17", zh: "把握每一個來到眼前的機會。", en: "Grasp every opportunity that comes your way.", author: "Indra Nooyi", authorZh: "英德拉・努伊", source: "nooyiWake", theme: "action", intensity: "balanced" },
  { id: "B18", zh: "並不完全是一條直線。", en: "Not exactly a straight line.", author: "Andy Jassy", authorZh: "安迪・賈西", source: "amazon2025", theme: "gentle", intensity: "gentle" },
  { id: "B19", zh: "即使我們保持樂觀，仍必須警醒並維持緊迫感。", en: "Though we are optimistic, we must remain vigilant and maintain a sense of urgency.", author: "Jeff Bezos", authorZh: "謝夫・貝索斯", source: "amazon1997", theme: "business", intensity: "strong" },
  { id: "B20", zh: "Day 2 就是停滯。", en: "Day 2 is stasis.", author: "Jeff Bezos", authorZh: "謝夫・貝索斯", source: "amazon2016", theme: "business", intensity: "strong" },
  { id: "B21", zh: "最嚴重的錯誤，是拖延改正已經發現的錯誤。", en: "The cardinal sin is delaying the correction of mistakes.", author: "Warren Buffett", authorZh: "華倫・巴菲特", source: "buffett2024", theme: "business", intensity: "strong" },
  { id: "B22", zh: "你的時間有限。", en: "Your time is limited.", author: "Steve Jobs", authorZh: "史提夫・喬布斯", source: "jobsStanford", theme: "action", intensity: "balanced" },
  { id: "B23", zh: "如果你停止學習新事物，就會停止做出有價值的成果。", en: "If you are not learning new things, you stop doing great and useful things.", author: "Satya Nadella", authorZh: "薩提亞・納德拉", source: "satyaFirstDay", theme: "business", intensity: "balanced" },
  { id: "B24", zh: "不要把自己看得太嚴肅、太重要。", en: "Don’t take yourself so seriously.", author: "Sam Walton", authorZh: "山姆・沃爾頓", source: "walmartRules", theme: "gentle", intensity: "gentle" },
  { id: "B25", zh: "沒有掙扎，就不會成就真正的作品。", en: "Where there is no struggle, there can be no art.", author: "Phil Knight", authorZh: "菲爾・奈特", source: "knightCommencement", theme: "gentle", intensity: "gentle" },
  { id: "B26", zh: "真正的學習永遠不會完結。", en: "Your real learning never ends.", author: "Indra Nooyi", authorZh: "英德拉・努伊", source: "nooyiWake", theme: "business", intensity: "balanced" },
  { id: "B27", zh: "前進的道路很少是筆直的。", en: "The path is rarely straight.", author: "Andy Jassy", authorZh: "安迪・賈西", source: "amazon2025", theme: "gentle", intensity: "gentle" },
  { id: "B28", zh: "一切都要從長期出發。", en: "It’s all about the long term.", author: "Jeff Bezos", authorZh: "謝夫・貝索斯", source: "amazon1997", theme: "business", intensity: "balanced" },
  { id: "B29", zh: "我們可以承受金錢損失，甚至很大的損失；但不能承受信譽受損。", en: "We can afford to lose money—even a lot of money. But we can’t afford to lose reputation.", author: "Warren Buffett", authorZh: "華倫・巴菲特", source: "buffett2010", theme: "business", intensity: "strong" },
  { id: "B30", zh: "你必須找到自己真正熱愛的事情。", en: "You’ve got to find what you love.", author: "Steve Jobs", authorZh: "史提夫・喬布斯", source: "jobsStanford", theme: "gentle", intensity: "gentle" },
  { id: "B31", zh: "你必須更早開始，並且堅持得更久。", en: "You must start sooner, and carry on longer.", author: "Bill Gates", authorZh: "比爾・蓋茨", source: "gatesHarvard", theme: "action", intensity: "strong" },
  { id: "B32", zh: "這個行業不會因傳統而尊重你；它只尊重創新。", en: "Our industry does not respect tradition—it only respects innovation.", author: "Satya Nadella", authorZh: "薩提亞・納德拉", source: "satyaFirstDay", theme: "business", intensity: "strong" },
  { id: "B33", zh: "全心投入你的事業。", en: "Commit to your business.", author: "Sam Walton", authorZh: "山姆・沃爾頓", source: "walmartRules", theme: "business", intensity: "balanced" },
  { id: "B34", zh: "逆流而上，不必盲從大多數。", en: "Swim upstream.", author: "Sam Walton", authorZh: "山姆・沃爾頓", source: "walmartRules", theme: "business", intensity: "balanced" },
  { id: "B35", zh: "永遠不要停止知識與思維上的成長。", en: "Never stop growing intellectually.", author: "Indra Nooyi", authorZh: "英德拉・努伊", source: "nooyiWake", theme: "business", intensity: "balanced" },
  { id: "B36", zh: "大部分長期事業，都不會沿着一條筆直向上的路發展。", en: "Most long-term endeavors do not follow a linear straight line.", author: "Andy Jassy", authorZh: "安迪・賈西", source: "amazon2025", theme: "gentle", intensity: "gentle" },
];

export const encouragements: Encouragement[] = rawQuotes.map(({ source, ...quote }) => ({
  ...quote,
  citation: sources[source][0],
  sourceUrl: sources[source][1],
}));

// 20 slots: gentle 35%, action 30%, business 20%, resilience 15%.
const themeSchedule: EncouragementTheme[] = [
  "gentle", "action", "business", "gentle", "resilience",
  "action", "gentle", "business", "action", "gentle",
  "resilience", "action", "gentle", "business", "action",
  "gentle", "resilience", "business", "action", "gentle",
];

export function hongKongDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function selectEncouragement({ pathname, dateKey, recentIds = [] }: {
  pathname: string;
  dateKey: string;
  recentIds?: string[];
}) {
  const theme = themeSchedule[stableHash(`${dateKey}:${pathname}:theme`) % themeSchedule.length];
  const themed = encouragements.filter((quote) => quote.theme === theme);
  const unseen = themed.filter((quote) => !recentIds.includes(quote.id));
  const pool = unseen.length > 0 ? unseen : themed;
  return pool[stableHash(`${dateKey}:${pathname}:quote`) % pool.length];
}

function stableHash(value: string) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}
