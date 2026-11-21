// No production writes: all APIs and two independent users are intercepted.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const origin = new URL(process.env.VERIFY_URL ?? "http://127.0.0.1:3197").origin;
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const fallback = ["今日總覽", "我的任務", "日曆", "資訊站", "交通"];
const prefs = new Map();
const writes = [];

async function openContext(user, width) {
  const context = await browser.newContext({ viewport: { width, height: 780 }, serviceWorkers: "block", locale: "zh-HK" });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.stack ?? error.message));
  const today = "2026-11-23", date = today + "T01:00:00Z";
  await page.clock.setFixedTime(new Date(date));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    const method = request.method();
    if (!url.pathname.startsWith("/api/")) return ["GET", "HEAD"].includes(method) ? route.continue() : route.abort();
    let json = {}, status = 200;
    if (method === "POST") {
      assert.equal(url.pathname, "/api/control");
      const body = request.postDataJSON();
      assert.deepEqual(Object.keys(body).sort(), ["action", "settings"]);
      assert.equal(body.action, "save_settings");
      assert.deepEqual(Object.keys(body.settings), ["pinned_pages"]);
      writes.push({ user, body });
      if (writes.length === 1) { json = { error: "暫時未能更新" }; status = 503; }
      else { prefs.set(user, body.settings.pinned_pages); json = { settings: body.settings }; }
    } else if (method !== "GET") {
      return route.abort();
    } else if (url.pathname === "/api/auth") {
      json = { user: { id: user } };
    } else if (url.pathname === "/api/control") {
      const view = url.searchParams.get("view");
      if (view === "assignment_alerts") json = { assignments: [], currentUserId: user, quietModeUntil: null };
      else json = {
        currentUser: { id: user, displayName: "捷徑測試", email: "pins-fixture@example.test" },
        participants: [{ user_id: user, display_name: "捷徑測試" }],
        profile: { user_id: user, active: true, is_admin: false, workspace_role: "derek", timezone: "Asia/Hong_Kong" },
        settings: { theme: "light", focus_minutes: 25, pinned_pages: prefs.get(user) ?? [] },
        household: null, calendarConnections: [], tasks: [], taskQueueCatalog: [], taskCatalog: [], taskTags: [], taskSteps: [],
        taskFollowers: [], assignments: [], shares: [], planning: [], taskNoticeRecipients: [], taskDependencies: [],
        reminders: [], capacityCommitments: [], notificationPreferences: null, notificationDeliveries: [],
        operatingItems: [], transactions: [], recurringExpenseRules: [], recurringIncomeRules: [], balances: [], meetings: []
      };
    } else if (url.pathname === "/api/calendar-brief") {
      json = { generatedAt: date, from: today, untilExclusive: "2026-11-26", days: [], familyDates: [], sources: [], warnings: [] };
    } else if (url.pathname === "/api/information") {
      json = { prefs: { journals: false, news: false, traffic: false }, routes: [] };
    } else if (url.pathname === "/api/start-links") {
      json = { links: [], shortcuts: [], ownerId: user };
    } else if (url.pathname === "/api/weather/hong-kong") {
      json = { observed: { temperature: 21, icon: 50, at: date }, forecast: [], warnings: [], checkedAt: date };
    }
    return route.fulfill({ json, status });
  });
  const nav = page.getByRole("navigation", { name: "主要導覽", exact: true });
  const menu = page.locator(".dl-all-nav > summary");
  const manage = page.getByRole("button", { name: "自訂頂欄捷徑", exact: true });
  async function read(expected) {
    await page.waitForFunction(labels => {
      const pins = [...document.querySelectorAll(".dl-nav--pinned a")].map(link => link.textContent?.trim());
      return labels.length === pins.length && labels.every((label, index) => label === pins[index]);
    }, expected);
    await nav.getByRole("link", { name: expected[0], exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  async function edit() {
    if (!(await manage.isVisible())) {
      await menu.waitFor({ state: "visible" }).catch(async error => {
        const view = (await page.locator("body").innerText()).slice(0, 200);
        throw new Error(`Menu not available: ${view}; ${errors.join(", ")}`, { cause: error });
      });
      await menu.press("Enter");
    }
    await page.waitForFunction(() => {
      const button = document.querySelector(".dl-pin-trigger");
      return button?.getClientRects().length && !button.disabled;
    });
    await manage.press("Enter");
    const form = page.getByRole("form", { name: "自訂頂欄捷徑", exact: true });
    await form.waitFor();
    return form;
  }
  return { context, page, nav, menu, manage, edit, read, errors };
}

const first = "71222222-1111-4111-8111-111111111111";
const second = "71222222-1111-4111-8111-111111111112";
try {
  const mobile = await openContext(first, 320);
  await mobile.page.goto(origin);
  await mobile.read(fallback);
  const form = await mobile.edit();
  assert.equal(await form.locator("select option[value='/admin/accounts']").count(), 0);
  await form.getByRole("combobox", { name: "捷徑 1", exact: true }).selectOption("/cashflow");
  await form.getByRole("combobox", { name: "捷徑 2", exact: true }).selectOption("/workspace/school");
  await form.getByRole("combobox", { name: "捷徑 2", exact: true }).selectOption("/cashflow");
  assert.equal(await form.getByRole("combobox", { name: "捷徑 1", exact: true }).inputValue(), "/workspace/school");
  await form.getByRole("combobox", { name: "捷徑 3", exact: true }).selectOption("");
  await form.getByRole("combobox", { name: "捷徑 4", exact: true }).selectOption("/medications");
  await form.getByRole("button", { name: "儲存捷徑", exact: true }).click();
  await form.getByRole("alert").waitFor();
  await mobile.read(fallback);
  assert.equal(await form.getByRole("combobox", { name: "捷徑 2", exact: true }).inputValue(), "/cashflow");
  await form.getByRole("button", { name: "儲存捷徑", exact: true }).click();
  await mobile.page.getByText("已儲存頂欄捷徑。", { exact: true }).waitFor();
  const customOrder = ["子女學校", "個人財務", "藥物紀錄", "交通"];
  await mobile.read(customOrder);
  assert.equal(await mobile.manage.evaluate(el => el === document.activeElement), true);
  await mobile.page.getByRole("link", { name: "日序 Dayline · 今日總覽" }).click();
  await mobile.nav.getByRole("link", { name: "個人財務" }).click();
  await mobile.page.waitForURL(origin + "/cashflow");
  await mobile.read(customOrder);
  assert.equal(await mobile.nav.getByRole("link", { name: "個人財務" }).getAttribute("aria-current"), "page");
  await mobile.page.getByRole("link", { name: "日序 Dayline · 今日總覽" }).click();
  await mobile.page.waitForURL(origin + "/");
  await mobile.read(customOrder);
  assert.deepEqual(mobile.errors, []);
  await mobile.context.close();

  const independent = await openContext(second, 1280);
  await independent.page.goto(origin);
  await independent.read(fallback);
  await independent.edit(); // Wait until this second account's settings are loaded.
  await independent.read(fallback);
  assert.equal(prefs.has(second), false);
  assert.deepEqual(independent.errors, []);
  await independent.context.close();

  const desktop = await openContext(first, 1280);
  await desktop.page.goto(origin);
  await desktop.read(customOrder);
  const freshEditor = await desktop.edit();
  await freshEditor.getByRole("button", { name: "恢復預設", exact: true }).click();
  await freshEditor.getByRole("button", { name: "儲存捷徑", exact: true }).click();
  await desktop.read(fallback);
  assert.deepEqual(desktop.errors, []);
  await desktop.context.close();

  assert.deepEqual(writes.map(item => item.user), [first, first, first]);
  console.log("PASS 320/1280: keyboard editor, pin swap/order, login account sync, storage/write failure, reset, isolated users, unchanged candidate authorization and home navigation.");
} finally {
  await browser.close();
}
