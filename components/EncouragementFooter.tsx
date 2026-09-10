"use client";

import Image from "next/image";
import { ExternalLink, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import {
  encouragements,
  hongKongDateKey,
  selectEncouragement,
  type Encouragement,
} from "@/lib/encouragements";

const HISTORY_KEY = "dcp:encouragement-history:v2";
const MAX_RECENT_QUOTES = 12;

export function EncouragementFooter({ pathname }: { pathname: string }) {
  const [quote, setQuote] = useState<Encouragement>(() =>
    selectEncouragement({ pathname, dateKey: "initial" })
  );

  useEffect(() => {
    const recentIds = readRecentIds();
    const next = selectEncouragement({ pathname, dateKey: hongKongDateKey(), recentIds });
    setQuote(next);
    rememberQuote(next.id, recentIds);
  }, [pathname]);

  return (
    <aside className="encouragement-footer no-print" aria-label="今日鼓勵">
      <div className="encouragement-glow encouragement-glow-one" aria-hidden="true" />
      <div className="encouragement-glow encouragement-glow-two" aria-hidden="true" />
      <div className="encouragement-copy">
        <div className="encouragement-kicker">
          <span className="encouragement-icon" aria-hidden="true"><Sparkles className="h-5 w-5" /></span>
          <span>今日一句 · Daily perspective</span>
          <span className={"encouragement-theme encouragement-theme-" + quote.theme}>{themeLabel(quote.theme)}</span>
        </div>
        <blockquote>
          <p className="encouragement-quote-zh">「{quote.zh}」</p>
          <p className="encouragement-quote-en">“{quote.en}”</p>
        </blockquote>
        <div className="encouragement-attribution">
          <span>— {quote.authorZh} · {quote.author}</span>
          <span className="encouragement-citation">{quote.citation}</span>
          <a href={quote.sourceUrl} target="_blank" rel="noreferrer" aria-label={"查看 " + quote.author + " 語錄來源"}>
            核實來源 <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
      <Image
        className="encouragement-art"
        src="/illustrations/small-steps-sunrise.webp"
        alt="三級小步通往日出，象徵持續前進"
        width={220}
        height={147}
        sizes="(max-width: 640px) 110px, 180px"
      />
    </aside>
  );
}

function readRecentIds() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    const validIds = new Set(encouragements.map((quote) => quote.id));
    return value.filter((id): id is string => typeof id === "string" && validIds.has(id)).slice(0, MAX_RECENT_QUOTES);
  } catch {
    return [];
  }
}

function rememberQuote(id: string, recentIds: string[]) {
  try {
    const next = [id, ...recentIds.filter((recentId) => recentId !== id)].slice(0, MAX_RECENT_QUOTES);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // The quote still renders when browser storage is unavailable.
  }
}

function themeLabel(theme: Encouragement["theme"]) {
  if (theme === "gentle") return "溫和支持";
  if (theme === "action") return "開始行動";
  if (theme === "business") return "事業思維";
  return "堅持向前";
}
