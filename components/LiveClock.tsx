"use client";

import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatHongKongClock } from "@/lib/live-clock";

export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const clock = now ? formatHongKongClock(now) : null;

  return (
    <div className="site-clock-bar no-print">
      <div className="live-clock">
        <span className="live-clock-zone"><Clock3 className="live-clock-icon" aria-hidden="true" />香港時間</span>
        <time className="live-clock-time" dateTime={clock?.iso}>
          {clock?.timeLabel ?? "--:--:--"}
        </time>
        <span className="live-clock-date">{clock?.dateLabel ?? "正在同步"}</span>
      </div>
    </div>
  );
}
