import assert from "node:assert/strict";
import test from "node:test";
import { bundledHongKongClockCalendar, isClockCalendarDate, officialLunarDate, officialPublicHolidays, parseHongKongClockCalendar } from "../lib/hong-kong-clock-calendar.ts";
import { formatHongKongClock } from "../lib/live-clock.ts";

test("live clock always formats the supplied instant in Hong Kong time", () => {
  const result = formatHongKongClock(new Date("2026-09-10T12:34:56.000Z"));
  assert.equal(result.timeLabel, "20:34:56");
  assert.equal(result.dateLabel, "10/09/26 (Thu)");
  assert.equal(result.dateKey, "2026-09-10");
  assert.equal(result.isSunday, false);
  assert.equal(result.iso, "2026-09-10T12:34:56.000Z");
});

test("Hong Kong day and Sunday flag change at midnight HKT, not midnight UTC", () => {
  const before = formatHongKongClock(new Date("2026-11-28T15:59:59.000Z"));
  const after = formatHongKongClock(new Date("2026-11-28T16:00:00.000Z"));
  assert.equal(before.isSunday, false);
  assert.equal(after.timeLabel, "00:00:00");
  assert.equal(after.dateKey, "2026-11-29");
  assert.equal(after.dateLabel, "29/11/26 (Sun)");
  assert.equal(after.isSunday, true);
  assert.equal(bundledHongKongClockCalendar(after.dateKey).holidayName, null);
});

test("published HKO lunar dates retain leap months and the 2027 Lunar New Year boundary", () => {
  assert.equal(bundledHongKongClockCalendar("2025-01-01").lunarDate, "十二月初二");
  assert.equal(bundledHongKongClockCalendar("2025-07-25").lunarDate, "閏六月初一");
  assert.equal(bundledHongKongClockCalendar("2026-11-25").lunarDate, "十月十七");
  assert.equal(bundledHongKongClockCalendar("2027-02-05").lunarDate, "十二月廿九");
  assert.deepEqual(bundledHongKongClockCalendar("2027-02-06"), {
    date: "2027-02-06", lunarDate: "正月初一", holidayName: "農曆年初一"
  });
  assert.equal(bundledHongKongClockCalendar("2028-06-23").lunarDate, "閏五月初一");
  assert.equal(bundledHongKongClockCalendar("2029-01-01").lunarDate, null);
});

test("named holidays use gazetted dates, including compensatory holidays", () => {
  assert.equal(bundledHongKongClockCalendar("2026-04-06").holidayName, "清明節翌日");
  assert.equal(bundledHongKongClockCalendar("2026-04-07").holidayName, "復活節星期一翌日");
  assert.equal(bundledHongKongClockCalendar("2027-02-09").holidayName, "農曆年初四");
  assert.equal(bundledHongKongClockCalendar("2027-12-27").holidayName, "聖誕節後第一個周日");
  assert.equal(bundledHongKongClockCalendar("2026-11-25").holidayName, null);
});

test("calendar feed validation rejects stale, invalid and non-date events", () => {
  assert.equal(isClockCalendarDate("2026-02-30"), false);
  assert.equal(isClockCalendarDate("2028-02-29"), true);
  assert.equal(officialLunarDate({ LunarDate: "正月初一" }), "正月初一");
  assert.equal(officialLunarDate({ LunarDate: "十二月31日" }), null);
  assert.equal(parseHongKongClockCalendar({ date: "2027-02-06" }, "2027-02-07"), null);
  assert.equal(parseHongKongClockCalendar({ date: "2027-02-06", lunarDate: null, holidayName: 9 }, "2027-02-06"), null);
  assert.deepEqual(parseHongKongClockCalendar({ date: "2027-02-06", lunarDate: "正月初一", holidayName: "農曆年初一" }, "2027-02-06"), {
    date: "2027-02-06", lunarDate: "正月初一", holidayName: "農曆年初一"
  });
  const dates = officialPublicHolidays({ vcalendar: [{ vevent: [
    { dtstart: ["20270206", { value: "DATE" }], summary: "農曆年初一" },
    { dtstart: ["20270207", { value: "DATE" }], summary: "星期日" },
    { dtstart: ["20270230", { value: "DATE" }], summary: "日期無效" },
    { dtstart: ["20270209", { value: "DATE-TIME" }], summary: "唔係全日假期" },
  ] }] });
  assert.deepEqual([...dates], [["2027-02-06", "農曆年初一"]]);
});
