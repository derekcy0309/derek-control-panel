"use client";
import { useEffect, useState } from "react";
import { briefDate } from "@/lib/calendar-brief";
import { nextHkMidnight } from "@/lib/dayline";

export function useDaylineDate() {
  const [today, setToday] = useState(() => briefDate());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { clearTimeout(timer); const now = new Date(); setToday(briefDate(now)); timer = setTimeout(tick, Math.max(1000, nextHkMidnight(now)-now.getTime()+100)); };
    const visible = () => { if (document.visibilityState === "visible") tick(); };
    tick(); document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);
  return today;
}
