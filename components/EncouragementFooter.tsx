import { Sparkles } from "lucide-react";

const encouragements = [
  "今日唔需要完成全部；推進最重要嗰一步已經有價值。",
  "做得慢唔等於停滯，保持向前就仍然係進度。",
  "先完成一個可見動作，動力會在行動之後出現。",
  "狀態低落時，最低可行的一步都算完成今日承諾。",
  "千里之行，始於足下。——《道德經》",
  "你可以重新開始，不需要等到下一個星期一。",
  "休息係容量管理，不係放棄；回來後再做下一步。",
  "唔好用今日嘅能量，批判整個人生嘅進度。"
] as const;

export function EncouragementFooter({ pathname }: { pathname: string }) {
  const index = stableIndex(pathname, encouragements.length);
  return (
    <aside className="encouragement-footer no-print" aria-label="今日鼓勵">
      <span className="encouragement-icon" aria-hidden="true"><Sparkles className="h-5 w-5" /></span>
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[.13em] text-fuchsia-700">Keep moving</p>
        <p className="mt-1 font-bold leading-6 text-slate-800">{encouragements[index]}</p>
      </div>
    </aside>
  );
}

function stableIndex(value: string, length: number) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % length;
}
