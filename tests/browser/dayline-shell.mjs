// Real Next pages with isolated, in-browser API fixtures; never write to an account.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const origin = new URL(process.env.VERIFY_URL || "http://127.0.0.1:3197").origin;
assert.ok(new URL(origin).hostname === "127.0.0.1" || /^https:\/\/derek-control-panel-[a-z0-9]+-derekcy0309-4881s-projects\.vercel\.app$/.test(origin));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const date = "2026-11-23", now = date + "T01:00:00Z";
const owner = "71111111-1111-4111-8111-111111111111", taskId = "71111111-1111-4111-8111-111111111112";
const currentUser = { id: owner, displayName: "一致性測試", email: "shell-fixture@example.test" };
const task = {
  id: taskId, title: "測試任務詳情", next_action: "確認導航仍然一樣", user_id: owner, owner_id: owner,
  status: "not_started", scope: "home", area: "personal", source_type: "follow_up", requested_priority: 1,
  due_date: date, archived_at: null, deleted_at: null, created_at: now, updated_at: now, personal_tag_ids: [],
};
const participants = [{ user_id: owner, display_name: currentUser.displayName }];
const taskDetail = {
  currentUser, task, participants, parentTask: null, taskTags: [], taskSteps: [], childTasks: [], assignments: [],
  handoffNotes: [], taskDependencies: [], taskRecurrenceRules: [], activityLogs: [], taskFollowers: [],
};

async function prepare(page, {admin = false, signedIn = true} = {}) {
  const errors = [], requests = [], writes = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /hydration error|cannot be a descendant/.test(message.text())) errors.push(message.text());
  });
  page.setDefaultTimeout(15000);
  await page.clock.setFixedTime(new Date(now));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    const { pathname, searchParams } = url, view = searchParams.get("view");
    if (!["GET", "HEAD"].includes(request.method())) {
      if (pathname.startsWith("/api/")) writes.push(pathname);
      return route.abort();
    }
    if (!pathname.startsWith("/api/")) return route.continue();
    requests.push(pathname);
    let json = {}, status = 200;
    if (pathname === "/api/auth") {
      if (signedIn) json = { user: { id: owner } };
      else { status = 401; json = { error: "未登入" }; }
    } else if (!signedIn || (pathname === "/api/admin/users" && !admin)) {
      status = signedIn ? 403 : 401; json = { error: "無權限" };
    } else if (pathname === "/api/control") {
      if (view === "assignment_alerts") json = { assignments: [], currentUserId: owner, quietModeUntil: null };
      else if (view === "task_detail") json = taskDetail;
      else if (view === "work_guide") json = { steps: [], checkpoint: null, openChildren: false };
      else if (view === "task_checkpoints") json = { checkpoints: [], latest: null };
      else if (view === "task_resources") json = { resources: [], options: [] };
      else if (view === "focus_sessions") json = { sessions: [] };
      else json = {
        currentUser, participants, profile: { user_id: owner, active: true, is_admin: admin, workspace_role: "derek", timezone: "Asia/Hong_Kong" },
        settings: { theme: "light", focus_minutes: 25 }, household: null, calendarConnections: [],
        tasks: [task], taskQueueCatalog: [task], taskCatalog: [task], taskTags: [], taskSteps: [], taskFollowers: [],
        assignments: [], shares: [], planning: [], taskNoticeRecipients: [], taskDependencies: [], reminders: [], capacityCommitments: [],
        notificationPreferences: null, notificationDeliveries: [], activePushSubscriptionCount: 0,
        operatingItems: [], transactions: [], recurringExpenseRules: [], recurringIncomeRules: [], balances: [], meetings: [],
      };
    } else if (pathname === "/api/calendar-brief") json = {
      generatedAt: now, from: date, untilExclusive: "2026-11-26", days: [], familyDates: [], sources: [], warnings: [],
    };
    else if (pathname === "/api/information") json = { prefs: { journals: false, news: false, traffic: false }, routes: [] };
    else if (pathname === "/api/start-links") json = { links: [], shortcuts: [], ownerId: owner };
    else if (pathname === "/api/weather/hong-kong") json = { observed: { temperature: 21, icon: 50, at: now }, forecast: [], warnings: [], checkedAt: now };
    else if (pathname === "/api/school-bot-review") json = { grants: [], pending: [], more: false };
    else if (pathname === "/api/admin/users") json = { users: [], truncated: false, currentUserId: owner };
    else if (pathname === "/api/hk-traffic") json = { at: now, roads: [], spots: [], notices: [], tolls: [], vehicle: "PC" };
    return route.fulfill({ json, status });
  });
  return { requests, writes, errors };
}

async function checkClock(page, pathname) {
  const rail = page.locator(".site-clock-bar");
  const clock = rail.locator(".live-clock");
  const time = clock.locator("time.live-clock-time").filter({ hasText: /^09:00:00$/ });
  await time.waitFor({ state: "visible" });
  assert.equal(await page.locator(".live-clock").count(), 1, "single site clock on " + pathname);
  assert.equal(await clock.locator(".live-clock-zone").filter({ hasText: /^香港時間$/ }).isVisible(), true);
  assert.equal(await time.getAttribute("datetime"), new Date(now).toISOString());
  assert.equal(await clock.locator(".live-clock-date").filter({ hasText: "23/11/26" }).isVisible(), true);
  const rect = await clock.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(rect && viewport && rect.x >= 0 && rect.x + rect.width <= viewport.width + 1 && rect.y >= -1 && rect.y + rect.height <= viewport.height, "clock fits within viewport on " + pathname);
  assert.ok(await time.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize) >= 18), "time is easy to spot on " + pathname);
}

try {
  for (const width of [360, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", locale: "zh-HK", timezoneId: "Asia/Hong_Kong", reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      const admin = width === 1280, { requests, writes, errors } = await prepare(page, { admin });
      const nav = page.getByRole("navigation", { name: "主要導覽", exact: true });
      const menuToggle = page.locator(".dl-mast .dl-all-nav > summary");
      const menu = page.locator(".dl-mast .dl-sheet-nav");
      let primaryLabels, layout;
      async function check(pathname, heading, activeLink) {
        await page.waitForURL(url => url.pathname === pathname);
        await page.getByRole("heading", { name: heading }).first().waitFor();
        await checkClock(page, pathname);
        assert.equal(await page.locator(".dl-shell").count(), 1, `Missing Dayline shell on ${pathname}: ${errors.join("; ") || (await page.locator("body").innerText()).slice(0, 160)}`);
        assert.equal(await page.locator(".dl-mast").count(), 1);
        assert.equal(await page.locator(".sidebar, .app-sidebar, .mobile-nav, .topbar-task-add").count(), 0);
        assert.equal(await page.getByRole("main").count(), 1, "one content landmark on " + pathname);
        assert.equal(await page.locator("main#main-content").count(), 1);
        assert.equal(await nav.count(), 1);
        const labels = (await nav.getByRole("link").allTextContents()).map(label => label.trim());
        if (!primaryLabels) primaryLabels = labels;
        assert.deepEqual(labels, primaryLabels, "primary navigation stays in the same order: " + pathname);
        const chrome = await page.locator(".dl-shell").evaluate(element => {
          const shell = getComputedStyle(element);
          const mast = element.querySelector(".dl-mast");
          const plate = element.querySelector(".dl-mastin").getBoundingClientRect();
          return {
            shellPaper: shell.getPropertyValue("--paper").trim(),
            mastBackground: getComputedStyle(mast).backgroundColor,
            position: [Math.round(plate.x), Math.round(plate.width), Math.round(plate.height)],
          };
        });
        if (!layout) layout = chrome;
        assert.deepEqual(chrome, layout, "masthead appearance and position stay consistent: " + pathname);
        assert.equal(await nav.getByRole("link", { name: "交通", exact: true }).getAttribute("href"), "/traffic");
        if (activeLink) assert.equal(await nav.getByRole("link", { name: activeLink, exact: true }).getAttribute("aria-current"), "page");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, pathname + " overflows at " + width);
      }
      async function pick(group, label) {
        if (!(await menu.isVisible())) await menuToggle.click();
        const toggle = menu.getByRole("button", { name: group, exact: true });
        if (!(await menu.getByRole("link", { name: label, exact: true }).isVisible())) await toggle.click();
        await menu.getByRole("link", { name: label, exact: true }).click();
      }
      await page.goto(origin + "/");
      await check("/", "今日總覽", "今日總覽");
      await menuToggle.focus();
      await menuToggle.press("Enter");
      await menu.waitFor({ state: "visible" });
      // Escape from within the drawer should close it and return keyboard focus.
      await menu.getByRole("link", { name: "搜尋", exact: true }).press("Escape");
      await menu.waitFor({ state: "hidden" });
      assert.equal(await menuToggle.evaluate(element => element === document.activeElement), true);

      await pick("系統設定", "設定");
      await check("/settings", /嘅設定/);
      await page.evaluate(() => window.scrollTo({ top: 200, behavior: "instant" }));
      await page.waitForFunction(() => scrollY >= 100);
      const stickyBounds = await page.locator(".site-clock-bar").boundingBox();
      assert.ok(stickyBounds && Math.abs(stickyBounds.y) <= 1, "clock stays at the top when scrolling at " + width);
      await checkClock(page, "/settings (scrolled)");
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await menu.waitFor({ state: "hidden" });
      await menuToggle.click();
      const system = menu.getByRole("button", { name: "系統設定", exact: true });
      if (await system.getAttribute("aria-expanded") !== "true") await system.click();
      assert.equal(await menu.getByRole("link", { name: "帳戶活動", exact: true }).count(), Number(admin), "account activity menu follows the role");
      await menuToggle.press("Escape");
      await menu.waitFor({ state: "hidden" });

      await pick("家庭", "子女及學校");
      await check("/workspace/school", "子女及學校");
      await pick("個人", "個人財務");
      await check("/cashflow", "現金流");
      await nav.getByRole("link", { name: "日曆", exact: true }).click();
      await check("/calendar", "日曆", "日曆");
      await nav.getByRole("link", { name: "我的任務", exact: true }).click();
      await check("/", "我的任務", "我的任務");
      const group = page.getByRole("button", { name: /^未完成/ });
      await group.click();
      await page.locator(".task-queue-row").filter({ hasText: task.title }).locator("summary").click();
      await page.getByRole("link", { name: task.title, exact: true }).click();
      await check("/tasks/" + taskId, "完整任務內容", "我的任務");
      await page.getByRole("link", { name: "返回任務", exact: true }).click();
      await check("/", "我的任務", "我的任務");
      await nav.getByRole("link", { name: "今日總覽", exact: true }).click();
      await check("/", "今日總覽", "今日總覽");
      assert.equal(requests.includes("/api/hk-traffic"), false, "other pages do not fetch traffic");
      await pick("計劃與跟進", "列印 To-do");
      await check("/todo-list", "列印 To-do List");
      await page.emulateMedia({ media: "print" });
      await page.locator(".dl-mast").waitFor({ state: "hidden" });
      await page.locator(".site-clock-bar").waitFor({ state: "hidden" });
      await page.locator(".todo-print-root").waitFor({ state: "visible" });
      await page.emulateMedia({ media: "screen" });
      await nav.getByRole("link", { name: "交通", exact: true }).click();
      await check("/traffic", "交通實況", "交通");
      assert.equal(requests.includes("/api/admin/users"), false, "a menu does not preload private accounts");
      if (admin) {
        await pick("系統設定", "帳戶活動");
        await check("/admin/accounts", "帳戶活動");
        assert.equal(requests.includes("/api/admin/users"), true);
      } else {
        await page.goto(origin + "/admin/accounts");
        await check("/admin/accounts", "這個頁面只供管理員使用");
        assert.equal(requests.includes("/api/admin/users"), false);
      }
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px signed in (${admin ? "admin" : "member"}): sticky Hong Kong clock, shared navigation and print without the clock; task, calendar, school, cashflow, traffic and admin views preserved.`);
    } finally {
      await context.close();
    }
  }

  const context = await browser.newContext({ viewport: { width: 360, height: 900 }, serviceWorkers: "block", timezoneId: "UTC" });
  try {
    const page = await context.newPage(), { requests, writes, errors } = await prepare(page, { signedIn: false });
    await page.goto(origin + "/admin/accounts");
    await page.getByRole("button", { name: "使用 Google 登入", exact: true }).waitFor();
    await checkClock(page, "/admin/accounts (signed out)");
    assert.equal(await page.locator(".dl-mast").count(), 0);
    assert.ok(requests.includes("/api/auth"));
    assert.equal(requests.includes("/api/admin/users"), false);
    assert.equal(requests.includes("/api/control"), false);
    await page.goto(origin + "/agent");
    await page.getByRole("heading", { name: "AI Bot 登入", exact: true }).waitFor();
    await checkClock(page, "/agent");
    await page.goto(origin + "/offline");
    await page.getByRole("heading", { name: "目前離線", exact: true }).waitFor();
    await checkClock(page, "/offline");
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log("PASS signed out: Hong Kong clock remains visible in a UTC browser on the user login, Bot login and offline route; no private account data requested.");
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}
