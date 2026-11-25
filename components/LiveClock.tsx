"use client";

import { Clock3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bundledHongKongClockCalendar, parseHongKongClockCalendar, type HongKongClockCalendarDay } from "@/lib/hong-kong-clock-calendar";
import { formatHongKongClock } from "@/lib/live-clock";

export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  const [officialDay, setOfficialDay] = useState<HongKongClockCalendarDay | null>(null);

  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const clock = now ? formatHongKongClock(now) : null;
  const date = clock?.dateKey ?? "";
  const bundledDay = useMemo(() => date ? bundledHongKongClockCalendar(date) : null, [date]);

  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    // The seconds update is local; this public feed runs only when the HK date changes.
    void fetch(`/api/hk-calendar-day?date=${date}`, {
      credentials: "omit",
      signal: controller.signal
    }).then(async (response) => {
      if (!response.ok) return;
      const result = parseHongKongClockCalendar(await response.json(), date);
      if (result && !controller.signal.aborted) setOfficialDay(result);
    }).catch(() => { /* The verified calendar snapshot stays available. */ });
    return () => controller.abort();
  }, [date]);

  const lunarDate = (officialDay?.date === date ? officialDay.lunarDate : null) ?? bundledDay?.lunarDate;
  const holidayName = officialDay?.date === date ? officialDay.holidayName : bundledDay?.holidayName;
  const redDate = clock?.isSunday || Boolean(holidayName);

  return (
    <div className="site-clock-bar no-print" data-red-date={redDate || undefined} data-holiday={holidayName ? true : undefined}>
      <div className="live-clock">
        <span className="live-clock-zone"><Clock3 className="live-clock-icon" aria-hidden="true" />香港時間</span>
        <time className="live-clock-time" dateTime={clock?.iso}>
          {clock?.timeLabel ?? "--:--:--"}
        </time>
        <span className="live-clock-dates">
          <span className="live-clock-date">{clock?.dateLabel ?? "正在同步"}</span>
          <span className="live-clock-lunar">{lunarDate ? `農曆 ${lunarDate}` : (date ? "農曆暫未能顯示" : "農曆 —")}</span>
        </span>
        {holidayName ? <span className="live-clock-holiday"><span className="sr-only">香港公眾假期：</span>{holidayName}</span> : null}
      </div>
    </div>
  );
}
