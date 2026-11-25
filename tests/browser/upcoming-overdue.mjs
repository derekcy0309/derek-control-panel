// Real Next UI with a deterministic Hong Kong date and mock data only.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const origin = new URL(process.env.VERIFY_URL || "http://127.0.0.1:3191").origin;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Use a loopback Dayline dev server.");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const now = "2026-11-24T21:30:00Z", today = "2026-11-25"; // Already Wednesday in Hong Kong, still Tuesday UTC.
const id = n => "64000000-0000-4000-8000-" + String(n).padStart(12, "0");
const owner = id(1), colleague = id(2);
const me = { id: owner, displayName: "限期測試", email: "queue@example.test" };
const priorities = [1, 2, 3].map(n => ({ id: id(100 + n), name: "P" + n, legacy_key: "priority_p" + n }));
const [p1, p2, p3] = priorities;
const wecare = { id: id(104), name: "Wecare", legacy_key: "wecare" };
const tags = [...priorities, wecare];

function task(n, title, due, priority = 3, extra = {}) {
  return {
    id: id(n), owner_id: owner, user_id: owner, scope: "home", area: "personal", source_type: "follow_up",
    title, due_date: due, status: "not_started", next_action: "核對日期", requested_priority: priority * 2 - 1,
    priority_grade: priority, priority_selected_grade: priority, priority_escalation_date: due,
    personal_tag_ids: [priorities[priority - 1].id, wecare.id], archived_at: null, deleted_at: null,
    created_at: now, updated_at: now, ...extra
  };
}

const waiting = task(11, "過期限期｜等回覆", "2026-11-20", 3, { status: "waiting" });
const blocked = task(12, "過期限期｜受阻", "2026-11-21", 3, { status: "blocked" });
const older = task(13, "過期限期｜未完成", "2026-11-23", 3);
const yesterday = task(14, "昨日到期｜已接手", "2026-11-24", 3, { owner_id: colleague, user_id: colleague });
const dueToday = task(16, "今日到期｜唔係已過期", today, 1);
const weekTwo = task(17, "原本十四日後的任務，已改期", "2026-12-08", 3, { priority_escalation_date: "2026-12-09" });
const weekOne = task(18, "七日後 P2 任務", "2026-12-02", 2);
const immediateP3 = task(19, "七日後 P3 任務", "2026-12-02");
const beyond = task(20, "十五日後 P3 任務", "2026-12-10");
const eighth = task(21, "八日後 P3 任務", "2026-12-03");
const excluded = [
  task(30, "已完成｜不計", "2026-11-18", 3, { status: "done" }),
  task(31, "已取消｜不計", "2026-11-19", 3, { status: "cancelled" }),
  task(32, "已封存｜不計", "2026-11-19", 3, { archived_at: now }),
  task(33, "已刪除｜不計", "2026-11-19", 3, { deleted_at: now }),
  task(34, "同事負責｜不計", "2026-11-19", 3, { owner_id: colleague, user_id: colleague }),
  task(35, "派俾同事｜不計", "2026-11-19", 3),
  task(36, "未接手｜不計", "2026-11-19", 3, { owner_id: colleague, user_id: colleague }),
  task(37, "無期限｜不計", null, 3),
];
const tasks = [waiting, blocked, older, yesterday, dueToday, weekTwo, weekOne, immediateP3, beyond, eighth, ...excluded];
const assignments = [
  { id: id(200), resource_type: "task", resource_id: yesterday.id, assigned_to_id: owner, assigned_by_id: colleague, status: "accepted" },
  { id: id(201), resource_type: "task", resource_id: excluded[5].id, assigned_to_id: colleague, assigned_by_id: owner, status: "accepted" },
  { id: id(202), resource_type: "task", resource_id: excluded[6].id, assigned_to_id: owner, assigned_by_id: colleague, status: "pending_acceptance" },
];
const fixture = {
  currentUser: me,
  profile: { user_id: owner, display_name: me.displayName, workspace_role: "derek", active: true, is_admin: true },
  settings: { theme: "light", focus_minutes: 25 },
  participants: [{ user_id: owner, display_name: me.displayName }, { user_id: colleague, display_name: "同事" }],
  tasks, taskQueueCatalog: tasks, taskCatalog: tasks, taskTags: tags, assignments,
  taskNoticeRecipients: [], taskFollowers: [], taskDependencies: [], planning: [], shares: [], taskSteps: [],
  capacity: null, capacityCommitments: [], reminders: [], notificationPreferences: null, calendarConnections: [],
};

async function intercept(page) {
  const writes = [], errs = [], reads = new Set();
  page.on("pageerror", err => errs.push(err.message));
  await page.clock.setFixedTime(new Date(now));
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) return route.abort();
    if (!["GET", "HEAD"].includes(req.method())) {
      // Next dev posts for local overlay stack frames; those are not app writes.
      if (url.pathname.startsWith("/api/")) writes.push(url.pathname);
      return route.abort();
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let json = {};
    if (url.pathname === "/api/auth") json = { user: { id: owner } };
    else if (url.pathname === "/api/control") {
      const view = url.searchParams.get("view");
      reads.add(view);
      if (view === "assignment_alerts") json = { assignments: [], currentUserId: owner, quietModeUntil: null };
      else if (view === "task_tags") json = { tags, taskTagIds: tasks.find(t => t.id === url.searchParams.get("taskId"))?.personal_tag_ids || [] };
      else if (view === "work_guide") json = { steps: [], checkpoint: null, openChildren: false };
      else json = fixture;
    } else if (url.pathname === "/api/calendar-brief") json = { from: today, untilExclusive: "2026-11-28", generatedAt: now, days: [], sources: [], familyDates: [] };
    else if (url.pathname === "/api/information") json = { prefs: { journals: false, news: false, traffic: false }, routes: [] };
    else if (url.pathname === "/api/start-links") json = { links: [], shortcuts: [], ownerId: owner };
    else if (url.pathname === "/api/weather/hong-kong") json = { observed: { temperature: 21, icon: 50, at: now }, forecast: [], warnings: [], checkedAt: now };
    return route.fulfill({ json, status: 200 });
  });
  return { writes, errs, reads };
}

try {
  for (const width of [360, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "zh-HK", timezoneId: "Asia/Hong_Kong", serviceWorkers: "block", reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(16000);
      const { writes, errs, reads } = await intercept(page);
      await page.goto(origin + "/");
      const banner = page.getByRole("region", { name: "已過期", exact: true });
      await banner.getByText("4 項", { exact: true }).waitFor();
      assert.equal(await banner.getByRole("link").count(), 3, "Only the three oldest overdue tasks are previewed.");
      assert.equal(await banner.getByText(waiting.title, { exact: true }).count(), 1);
      assert.equal(await banner.getByText(blocked.title, { exact: true }).count(), 1);
      assert.equal(await banner.getByText(older.title, { exact: true }).count(), 1);
      assert.equal(await banner.getByText(yesterday.title, { exact: true }).count(), 0);
      assert.equal(await banner.getByText("過期 5 日", { exact: true }).count(), 1);
      assert.equal(await banner.getByText("等回覆", { exact: true }).count(), 1);
      assert.equal(await banner.getByText("等解除阻塞", { exact: true }).count(), 1);
      const bannerOrder = await banner.evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector(".dl-board")) & Node.DOCUMENT_POSITION_FOLLOWING));
      assert.equal(bannerOrder, true, "Overdue summary must render before the main dashboard board.");
      assert.equal(await banner.getByRole("link").first().getAttribute("href"), "/tasks/" + waiting.id);

      await page.locator(".dl-support > summary").click();
      await page.getByRole("button", { name: /即將到期 · 14 日/ }).click();
      const upcoming = page.getByRole("region", { name: "即將到期 · 14 日" });
      await upcoming.getByText(weekTwo.title, { exact: true }).waitFor();
      const upcomingLink = record => upcoming.locator('a[href="/tasks/' + record.id + '"]');
      for (const [record, grade, label] of [[weekTwo, 2, "Urgent"], [eighth, 2, "Urgent"], [weekOne, 1, "First priority"], [immediateP3, 1, "First priority"]]) {
        assert.equal(await upcomingLink(record).locator('[data-tag-id="dayline-priority:' + grade + '"]').textContent(), "自動升級 · " + label);
      }
      assert.equal(await upcoming.getByText(beyond.title, { exact: true }).count(), 0);
      assert.equal(await upcoming.getByText(yesterday.title, { exact: true }).count(), 0);
      assert.ok(reads.has("today_focus") && reads.has("today"), "Uses the dashboard's existing scoped data reads.");

      const startUrl = page.url();
      await banner.getByRole("button", { name: "睇晒已過期" }).click();
      const overdueList = page.locator("#task-overdue");
      await overdueList.getByText(yesterday.title, { exact: true }).waitFor();
      await page.waitForFunction(() => document.activeElement?.id === "task-overdue");
      assert.equal(page.url(), startUrl, "The all-overdue view stays in the dashboard.");
      assert.deepEqual(await overdueList.locator(".task-queue-row summary strong").allTextContents(), [waiting, blocked, older, yesterday].map(t => t.title));
      for (const task of [dueToday, weekTwo, ...excluded]) {
        assert.equal(await overdueList.getByText(task.title, { exact: true }).count(), 0);
      }

      await page.getByRole("button", { name: "返回全部任務" }).click();
      assert.equal(await overdueList.count(), 0);
      const queue = page.locator("#task-action-list");
      const filters = queue.getByRole("region", { name: "選擇任務 Tags" });
      await filters.locator('button[data-tag-id="dayline-priority:2"]').click();
      await queue.getByRole("button", { name: /^未完成/ }).click();
      const row = record => queue.locator(".task-queue-row").filter({ hasText: record.title });
      await row(weekTwo).waitFor();
      assert.equal(await row(weekTwo).locator('[data-tag-id="dayline-priority:2"]').count(), 1);
      assert.equal(await row(weekTwo).locator('[data-tag-id="dayline-priority:3"]').count(), 0);
      assert.equal(await row(weekOne).count(), 0);
      assert.equal(await row(beyond).count(), 0);
      await queue.getByRole("searchbox", { name: "搜尋 Task" }).fill("P2");
      await row(weekTwo).waitFor();

      await row(weekTwo).locator("summary").click();
      await row(weekTwo).getByRole("button", { name: /修改任務/ }).click();
      const dialog = page.getByRole("dialog", { name: "修改任務" });
      await dialog.locator("summary").filter({ hasText: "＋Tag（可選）" }).click();
      assert.equal(await dialog.locator('button[data-tag-id="' + p3.id + '"]').getAttribute("aria-pressed"), "true");
      assert.equal(await dialog.locator('button[data-tag-id="' + p2.id + '"]').getAttribute("aria-pressed"), "false");
      assert.equal(await dialog.locator('button[data-tag-id="' + wecare.id + '"]').getAttribute("aria-pressed"), "true");

      assert.deepEqual(writes, [], "No task, label, status or settings write should occur.");
      assert.deepEqual(errs, []);
      console.log("PASS " + width + "px: independent 14/7-day promotions, overdue preview/navigation, permissions and original edit tags.");
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
