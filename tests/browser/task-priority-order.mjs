// Integration test with a loopback Next.js server and synthetic records only.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const origin = new URL(process.env.VERIFY_URL || "http://127.0.0.1:3197").origin;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Use a loopback Dayline dev server.");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const today = "2026-11-25";
const timestamp = "2026-11-24T21:30:00.000Z";
const id = number => "82500000-0000-4000-8000-" + String(number).padStart(12, "0");
const owner = id(1);
const user = { id: owner, displayName: "排序測試", email: "priority@example.test" };
const otherUser = { id: id(2), displayName: "第二個測試帳戶", email: "other-priority@example.test" };
const fixturePassword = "test-fixture-only";
const preferenceKey = account => `dcp:my-tasks-sort:v1:${account.id}`;
const taskTags = [{ id: id(100), name: "排序測試 Tag", legacy_key: null }];

function task(number, title, grade, options = {}) {
  return {
    id: id(number), title, owner_id: owner, user_id: owner, scope: "home", area: "personal", source_type: "follow_up",
    due_date: null, status: "not_started", next_action: "查看下一步", requested_priority: 5,
    priority_grade: grade, priority_selected_grade: grade, priority_escalation_date: null,
    personal_tag_ids: [], archived_at: null, deleted_at: null, created_at: timestamp, updated_at: timestamp,
    ...options,
  };
}

const ungraded = task(11, "未分級但舊數字最高", null, { requested_priority: 1 });
const waiting = task(12, "最高級但等回覆", 1, { status: "waiting", personal_tag_ids: [taskTags[0].id] });
const first = task(13, "最高級而可以做", 1);
const promoted = task(14, "半急自動升級", 3, {
  priority_escalation_date: "2026-12-08",
  due_date: "2027-02-01",
  personal_tag_ids: [taskTags[0].id],
});
const blocked = task(15, "半急但有阻塞", 3, { status: "blocked" });
const low = task(16, "普通但我想今日先做", 4);
const completed = task(17, "已完成嘅最高級任務", 1, { status: "done" });
const tasks = [ungraded, promoted, completed, low, blocked, waiting, first];
const manuallyOrdered = [low, first];
const planning = manuallyOrdered.map((record, index) => ({
  user_id: owner, resource_type: "task", resource_id: record.id, planned_date: today,
  plan_role: index === 0 ? "now" : "later", plan_source: "manual", plan_position: index + 1, hidden_from_today: false,
})).reverse();

const taskData = {
  currentUser: user,
  profile: { user_id: owner, display_name: user.displayName, workspace_role: "derek", active: true, is_admin: false },
  settings: { theme: "light", focus_minutes: 25 },
  participants: [{ user_id: owner, display_name: user.displayName }],
  tasks, taskQueueCatalog: tasks, taskCatalog: tasks, taskTags, assignments: [], planning,
  taskNoticeRecipients: [], taskFollowers: [], taskDependencies: [], shares: [], taskSteps: [],
  capacity: null, capacityCommitments: [], reminders: [], notificationPreferences: null, calendarConnections: [],
};
const otherTask = task(21, "另一個帳戶嘅任務", 2, { owner_id: otherUser.id, user_id: otherUser.id });
const otherTaskData = {
  ...taskData,
  currentUser: otherUser,
  profile: { ...taskData.profile, user_id: otherUser.id, display_name: otherUser.displayName },
  participants: [{ user_id: otherUser.id, display_name: otherUser.displayName }],
  tasks: [otherTask], taskQueueCatalog: [otherTask], taskCatalog: [otherTask], taskTags: [], planning: [],
};

async function intercept(page) {
  const writes = [], errors = [], sessionActions = [];
  let signedIn = user;
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.setFixedTime(new Date(timestamp));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    // The sign-out and sign-in requests are the only allowed non-GET actions;
    // both are handled by the fake session and never reach the running app.
    if (url.pathname === "/api/auth" && request.method() === "DELETE") {
      signedIn = null;
      sessionActions.push("logout");
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    if (url.pathname === "/api/auth" && request.method() === "POST") {
      const input = request.postDataJSON();
      const account = [user, otherUser].find(item => item.email === input?.email);
      if (input?.action === "password" && input.password === fixturePassword && account) {
        signedIn = account;
        sessionActions.push(`login:${account.id}`);
        return route.fulfill({ status: 200, json: { user: { id: signedIn.id } } });
      }
    }
    if (!["GET", "HEAD"].includes(request.method())) {
      if (url.pathname.startsWith("/api/")) writes.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (!signedIn && (url.pathname === "/api/auth" || url.pathname === "/api/control")) {
      return route.fulfill({ status: 401, json: { error: "請先登入。" } });
    }
    let json = {};
    if (url.pathname === "/api/auth") json = { user: { id: signedIn.id } };
    else if (url.pathname === "/api/control") {
      const view = url.searchParams.get("view");
      if (view === "assignment_alerts") json = { assignments: [], currentUserId: signedIn.id, quietModeUntil: null };
      else if (view === "work_guide") json = { steps: [], checkpoint: null, openChildren: false };
      else json = signedIn.id === otherUser.id ? otherTaskData : taskData;
    }
    else if (url.pathname === "/api/calendar-brief") json = { from: today, untilExclusive: "2026-11-28", generatedAt: timestamp, days: [], sources: [], familyDates: [] };
    else if (url.pathname === "/api/hk-calendar-day") json = { date: today, lunarDate: "十月十七", holidayName: null };
    else if (url.pathname === "/api/information") json = { prefs: { journals: false, news: false, traffic: false }, routes: [] };
    else if (url.pathname === "/api/start-links") json = { links: [], shortcuts: [], ownerId: owner };
    else if (url.pathname === "/api/weather/hong-kong") json = { observed: { temperature: 21, icon: 50, at: timestamp }, forecast: [], warnings: [], checkedAt: timestamp };
    return route.fulfill({ json, status: 200 });
  });
  return { writes, errors, sessionActions };
}

try {
  for (const width of [360, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 }, locale: "zh-HK", timezoneId: "Asia/Hong_Kong", serviceWorkers: "block", reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(16000);
      const { writes, errors, sessionActions } = await intercept(page);
      await page.goto(origin + "/");
      const todayTab = page.getByRole("tab", { name: /今日全部/ });
      const allTab = page.getByRole("tab", { name: /任務總表/ });
      const todayPanel = page.locator("#action-center-panel-today");
      const queue = page.locator("#task-action-list");
      const sort = queue.getByRole("button", { name: "按分級排序", exact: true });
      const grades = queue.getByRole("region", { name: "按分級顯示工作", exact: true });

      async function verifyToday() {
        await todayTab.press("Enter").catch(error => {
          if (errors.length) console.error(errors);
          throw error;
        });
        await todayPanel.getByRole("heading", { name: "今日全部任務" }).waitFor();
        const taskLinks = todayPanel.locator('article a[href^="/tasks/"]');
        await taskLinks.first().waitFor();
        assert.deepEqual(await taskLinks.allTextContents(), manuallyOrdered.map(record => record.title));
      }

      async function signOut() {
        await page.getByLabel("更多功能", { exact: true }).press("Enter");
        await page.getByRole("button", { name: "登出", exact: true }).press("Enter");
        await page.getByRole("heading", { name: "登入日序", exact: true }).waitFor();
      }

      async function signIn(account) {
        await page.getByText("其他登入方法（後備）", { exact: true }).click();
        await page.getByLabel("電郵地址", { exact: true }).fill(account.email);
        await page.locator('input[autocomplete="current-password"]').fill(fixturePassword);
        await page.getByRole("button", { name: "登入", exact: true }).click();
        await allTab.click();
        await sort.waitFor();
      }

      await verifyToday();
      await allTab.click();
      await sort.waitFor();
      assert.equal(await sort.getAttribute("aria-pressed"), "false");
      await queue.getByRole("region", { name: "按狀態顯示工作", exact: true }).waitFor();
      await sort.click();
      await grades.waitFor();
      assert.equal(await sort.getAttribute("aria-pressed"), "true");
      const titles = ["First priority", "Urgent", "Semi urgent", "Non urgent", "未分級"];
      const sections = grades.locator(".task-queue-section");
      const buckets = [
        [waiting.title, first.title],
        [promoted.title],
        [blocked.title],
        [low.title],
        [ungraded.title],
      ];
      for (const [index, title] of titles.entries()) {
        const section = sections.nth(index);
        const header = section.getByRole("button", { name: new RegExp("^" + title) });
        await header.waitFor();
        if (index === 0) assert.equal(await header.getAttribute("aria-expanded"), "true", "the top bucket opens with one click");
        else {
          assert.equal(await header.getAttribute("aria-expanded"), "false", "lower buckets remain folded");
          await header.click();
        }
        const rows = await section.locator(".task-queue-row summary strong").allTextContents();
        assert.deepEqual([...rows].sort(), [...buckets[index]].sort(), "visible tasks in " + title);
      }
      const history = queue.getByRole("button", { name: /^已做完／已取消/ });
      assert.equal(await history.getAttribute("aria-expanded"), "false");
      assert.equal(await grades.getByText(completed.title, { exact: true }).count(), 0);

      await verifyToday();
      await allTab.click();
      await grades.waitFor();
      assert.equal(await sort.getAttribute("aria-pressed"), "true", "sort preference survives switching back from Today");
      const filters = queue.getByRole("region", { name: "選擇任務 Tags" });
      const tag = filters.locator(`button[data-tag-id="${taskTags[0].id}"]`);
      const search = queue.getByRole("searchbox", { name: "搜尋 Task" });
      await tag.click();
      await search.fill("自動升級");

      await sort.click();
      await queue.getByRole("region", { name: "按狀態顯示工作", exact: true }).waitFor();
      assert.equal(await sort.getAttribute("aria-pressed"), "false");
      assert.equal(await page.evaluate(key => localStorage.getItem(key), preferenceKey(user)), "status");
      assert.equal(await tag.getAttribute("aria-pressed"), "true");
      assert.equal(await search.inputValue(), "自動升級");
      await sort.click();
      await grades.waitFor();
      await grades.getByText(promoted.title, { exact: true }).waitFor();
      assert.equal(await grades.getByRole("button", { name: /^Urgent/ }).getAttribute("aria-expanded"), "true", "first matching bucket opens when First priority is empty");
      assert.equal(await grades.getByRole("button", { name: /^First priority/ }).count(), 0);
      assert.equal(await tag.getAttribute("aria-pressed"), "true");
      assert.equal(await search.inputValue(), "自動升級");

      await search.fill("");
      const showAll = filters.getByRole("button", { name: "全部", exact: true });
      const chips = filters.locator("button[data-tag-id]");
      const selectedChips = filters.locator('button[data-tag-id][aria-pressed="true"]');
      await showAll.click();
      assert.equal(await showAll.getAttribute("aria-pressed"), "true");
      assert.equal(await chips.count(), 5, "four grade chips and one custom Tag");
      assert.equal(await selectedChips.count(), 5);
      await grades.getByRole("button", { name: /^未分級/ }).click();
      await grades.getByText(ungraded.title, { exact: true }).waitFor();
      await tag.click();
      assert.equal(await tag.getAttribute("aria-pressed"), "false");
      assert.equal(await showAll.getAttribute("aria-pressed"), "false");
      assert.equal(await selectedChips.count(), 4);

      assert.equal(await page.evaluate(key => localStorage.getItem(key), preferenceKey(user)), "grade");
      await page.reload();
      await allTab.click();
      await grades.waitFor();
      assert.equal(await sort.getAttribute("aria-pressed"), "true", "remember after reload");
      await verifyToday();

      await signOut();
      await signIn(otherUser);
      await queue.getByRole("region", { name: "按狀態顯示工作", exact: true }).waitFor();
      assert.equal(await sort.getAttribute("aria-pressed"), "false", "other account starts with its own default");
      assert.equal(await page.evaluate(key => localStorage.getItem(key), preferenceKey(otherUser)), null);
      await signOut();
      await signIn(user);
      await grades.waitFor();
      assert.equal(await sort.getAttribute("aria-pressed"), "true", "original account remembers its choice on sign-in");
      await verifyToday();
      assert.deepEqual(sessionActions, ["logout", `login:${otherUser.id}`, "logout", `login:${user.id}`]);
      assert.deepEqual(writes, [], "switching the display order never writes records or Today positions");
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: independent per-login sort, all Tags selected, unchanged manual Today order and no task writes.`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
