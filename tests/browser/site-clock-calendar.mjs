// Verify the shared clock on a local Next server (VERIFY_URL defaults to port 3198).
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const origin = new URL(process.env.VERIFY_URL || "http://127.0.0.1:3198").origin;
assert.equal(new URL(origin).hostname, "127.0.0.1", "This fixture is local only.");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined });

function luminance(color) {
  const channels = color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(value => Number(value) / 255);
  return channels.reduce((sum, channel, i) => sum
    + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i], 0);
}

try {
  for (const [width, dark] of [[320, false], [320, true], [1280, true]]) {
    const context = await browser.newContext({
      viewport: { width, height: 800 }, serviceWorkers: "block", timezoneId: "UTC"
    });
    try {
      const page = await context.newPage();
      const requestedDates = [];
      const pageErrors = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      await page.route("**/api/hk-calendar-day?*", async route => {
        const day = new URL(route.request().url()).searchParams.get("date");
        requestedDates.push(day);
        if (day === "2028-01-01") {
          // A later government feed can add holidays outside the bundled years.
          return route.fulfill({ json: { date: day, lunarDate: null, holidayName: "測試來源假期" } });
        }
        // Simulate unavailable government data. The verified fallback must still
        // show every tested holiday, and must never carry one into the next day.
        return route.fulfill({ status: 503, json: { error: "fixture" } });
      });
      await page.clock.setFixedTime(new Date("2026-11-28T15:59:59.000Z"));
      await page.goto(origin + "/offline");
      if (dark) await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
      const rail = page.locator(".site-clock-bar");
      await rail.locator("time").filter({ hasText: /^23:59:59$/ }).waitFor();
      assert.equal(await rail.getAttribute("data-red-date"), null);

      await page.clock.setFixedTime(new Date("2026-11-28T16:00:00.000Z"));
      await rail.locator(".live-clock-date").filter({ hasText: /29\/11\/26 \(Sun\)/ }).waitFor();
      assert.equal(await rail.getAttribute("data-red-date"), "true");
      assert.equal(await rail.locator(".live-clock-holiday").count(), 0);

      await page.clock.setFixedTime(new Date("2027-02-05T16:00:00.000Z"));
      await rail.locator(".live-clock-lunar").filter({ hasText: "農曆 正月初一" }).waitFor();
      await rail.locator(".live-clock-holiday").filter({ hasText: "農曆年初一" }).waitFor();
      assert.equal(await rail.getAttribute("data-red-date"), "true");

      await page.clock.setFixedTime(new Date("2027-06-30T16:00:00.000Z"));
      const holiday = rail.locator(".live-clock-holiday").filter({ hasText: "香港特別行政區成立紀念日" });
      await holiday.waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      const colors = await rail.evaluate(el => ({
        foreground: getComputedStyle(el.querySelector(".live-clock-date")).color,
        background: getComputedStyle(el).backgroundColor
      }));
      assert.equal(colors.background, dark ? "rgb(25, 28, 35)" : "rgb(255, 255, 255)");
      const contrast = (Math.max(luminance(colors.foreground), luminance(colors.background)) + .05)
        / (Math.min(luminance(colors.foreground), luminance(colors.background)) + .05);
      assert.ok(contrast >= 4.5, `red date contrast: ${contrast}`);
      const box = await holiday.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, "full holiday name fits");
      await page.clock.setFixedTime(new Date("2027-12-31T16:00:00.000Z"));
      await rail.locator(".live-clock-holiday").filter({ hasText: "測試來源假期" }).waitFor();
      assert.equal(await rail.getAttribute("data-red-date"), "true");
      await page.clock.setFixedTime(new Date("2028-01-02T16:00:00.000Z"));
      await rail.locator(".live-clock-date").filter({ hasText: /03\/01\/28 \(Mon\)/ }).waitFor();
      assert.equal(await rail.getAttribute("data-red-date"), null);
      assert.equal(await rail.locator(".live-clock-holiday").count(), 0);
      await page.emulateMedia({ media: "print" });
      assert.equal(await rail.isVisible(), false);
      assert.ok(requestedDates.includes("2026-11-29") && requestedDates.includes("2027-07-01"));
      assert.ok(requestedDates.length <= 6, "calendar request is not repeated per second");
      assert.deepEqual(pageErrors, []);
      console.log(`PASS ${width}px ${dark ? "dark" : "light"}: HK midnight, lunar days, red Sundays and named holidays, narrow layout and print.`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
