import { bundledHongKongClockCalendar, isClockCalendarDate, officialLunarDate, officialPublicHolidays } from "@/lib/hong-kong-clock-calendar";
import { formatHongKongClock } from "@/lib/live-clock";

const holidayFeed = "https://www.1823.gov.hk/common/ical/tc.json";
const lunarFeed = "https://data.weather.gov.hk/weatherAPI/opendata/lunardate.php";
const responseHeaders = { "X-Content-Type-Options": "nosniff" };

async function readPublicCalendar(url: string, limit: number): Promise<unknown> {
  const response = await fetch(url, {
    credentials: "omit", redirect: "error", signal: AbortSignal.timeout(4_000),
    next: { revalidate: 21_600 }
  });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("Calendar feed unavailable");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, content = "";
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error("Calendar feed size exceeded");
      }
      content += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(content + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const dates = params.getAll("date");
  const date = dates[0] ?? "";
  const currentYear = Number(formatHongKongClock(new Date()).dateKey.slice(0, 4));
  const requestYear = Number(date.slice(0, 4));
  if (dates.length !== 1 || [...params.keys()].length !== 1 || !isClockCalendarDate(date) || requestYear < 2023 || requestYear > currentYear + 2) {
    return Response.json({ error: "請提供有效嘅公曆日期。" }, {
      status: 400, headers: { ...responseHeaders, "Cache-Control": "no-store" }
    });
  }

  const fallback = bundledHongKongClockCalendar(date);
  const [holidays, lunarDate] = await Promise.all([
    readPublicCalendar(holidayFeed, 90_000).then(officialPublicHolidays).catch(() => new Map<string, string>()),
    fallback.lunarDate
      ? Promise.resolve(fallback.lunarDate)
      : readPublicCalendar(`${lunarFeed}?date=${date}`, 4_096).then(officialLunarDate).catch(() => null)
  ]);
  const fresh = holidays.size > 0 && lunarDate !== null;
  if (!fresh) console.warn("hk-calendar-day: public calendar fallback");
  const prefix = date.slice(0, 4);
  const knownYear = holidays.has(`${prefix}-01-01`) && holidays.has(`${prefix}-12-25`)
    && [...holidays.keys()].filter(day => day.startsWith(prefix)).length >= 15;
  // A complete live year may replace a published date. A partial year can
  // confirm a holiday, but it cannot erase an already verified fallback date.
  const holidayName = holidays.get(date) ?? (knownYear ? null : fallback.holidayName);
  return Response.json({ date, lunarDate, holidayName }, {
    headers: {
      ...responseHeaders,
      "Cache-Control": fresh ? "public, max-age=1800, s-maxage=21600, stale-while-revalidate=3600" : "public, max-age=120, s-maxage=600"
    }
  });
}
