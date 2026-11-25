// Test the real Dayline UI and computed styles. The browser cannot make live data requests.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const origin = new URL(process.env.VERIFY_URL || "http://127.0.0.1:3142").origin;
assert.equal(new URL(origin).hostname, "127.0.0.1", "This fixture is local only");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const userId = "51000000-0000-4000-8000-000000000001";
const tagId = n => `52000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const taskId = n => `53000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tags = [["個人", "personal"], ["家庭", "family"], ["SEC", "sec"], ["WECARE", "wecare"]]
  .map(([name, legacy_key], i) => ({ id: tagId(i + 1), name, legacy_key }));
const [personal, family, sec, wecare] = tags;
const now = new Date("2026-11-24T09:00:00+08:00");
const date = "2026-11-24";
const identity = { id: userId, displayName: "假資料：Tag 測試", email: "fixture@example.test" };
const profile = { user_id: userId, display_name: identity.displayName, is_admin: false, active: true, workspace_role: "derek" };
const settings = { theme: "light", focus_minutes: 25 };
const task = (n, title, selectedTags) => ({
  id: taskId(n), title, user_id: userId, owner_id: userId, created_by_id: userId,
  next_action: "打開文件", scope: "home", area: "personal", status: "not_started",
  due_date: n === 1 ? date : null, requested_priority: 3,
  personal_tag_ids: selectedTags.map(tag => tag.id), created_at: now.toISOString(), updated_at: now.toISOString(),
});

async function colourSignature(chip) {
  const colors = await chip.evaluate(element => {
    const root = document.documentElement;
    const original = root.getAttribute("data-theme");
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    function rgba(value) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    }
    try {
      return ["light", "dark"].map(theme => {
        root.setAttribute("data-theme", theme);
        const style = getComputedStyle(element);
        return { theme, surface: rgba(style.backgroundColor), ink: rgba(style.color) };
      });
    } finally {
      if (original === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", original);
    }
  });
  function luminance(rgb) {
    return rgb.slice(0, 3).reduce((value, channel, i) => {
      const scaled = channel / 255;
      return value + (scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i];
    }, 0);
  }
  for (const { theme, surface, ink } of colors) {
    assert.deepEqual([surface[3], ink[3]], [255, 255], `${theme}: tag text and background must be solid`);
    const [a, b] = [luminance(surface), luminance(ink)].sort((first, second) => first - second);
    assert.ok((b + 0.05) / (a + 0.05) >= 4.5, `${theme}: small tag text must reach 4.5:1`);
  }
  return colors;
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
try {
  for (const width of [360, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Hong_Kong", locale: "zh-HK", serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      await page.clock.setFixedTime(now);
      page.setDefaultTimeout(12_000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const tasks = [task(1, "巡 SEC 測試", [sec]), task(2, "跟 WECARE 測試", [wecare]),
        task(3, "家庭事項測試", [family]), task(4, "個人事項測試", [personal]), task(5, "無標籤事項測試", [])];
      const snapshot = () => ({
        currentUser: identity, profile, settings, tasks, taskQueueCatalog: tasks, taskCatalog: tasks, taskTags: tags,
        participants: [], taskFollowers: [], taskNoticeRecipients: [], assignments: [], shares: [], reminders: [],
        planning: [{ user_id: userId, resource_type: "task", resource_id: tasks[0].id, planned_date: date, plan_role: "now", plan_source: "manual", plan_position: 1 }],
        taskDependencies: [], operatingItems: [], capacityCommitments: [], notificationPreferences: null,
      });
      const writes = [];
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url()), view = url.searchParams.get("view");
        if (url.origin !== origin) return route.abort();
        if (request.method() !== "GET") {
          if (url.pathname !== "/api/control" || request.method() !== "POST") return route.abort();
          const input = request.postDataJSON();
          writes.push(input);
          assert.equal(input.action, "create_task");
          const created = task(6, input.title, tags.filter(tag => input.tagIds.includes(tag.id)));
          tasks.push(created);
          return route.fulfill({ json: { task: created } });
        }
        if (!url.pathname.startsWith("/api/")) return route.continue();
        let body = { links: [], shortcuts: [], warnings: [], forecast: [] };
        if (url.pathname === "/api/auth") body = { user: { id: userId } };
        else if (view === "shell") body = { currentUser: identity, profile, settings };
        else if (view === "task_tags") body = { tags, taskTagIds: [] };
        else if (view === "assignment_alerts") body = { assignments: [], currentUserId: userId };
        else if (view === "work_guide") body = { steps: [], checkpoint: null, openChildren: false };
        else if (url.pathname === "/api/control") body = snapshot();
        else if (url.pathname === "/api/calendar-brief") body = { generatedAt: now.toISOString(), from: date, untilExclusive: "2026-11-27", days: [], familyDates: [], sources: [], warnings: [], text: "假資料" };
        else if (url.pathname === "/api/information") body = { prefs: { journals: false, news: false, traffic: false } };
        await route.fulfill({ json: body });
      });

      await page.goto(origin);
      const nowTag = page.locator(`.dl-focus [data-tag-id="${sec.id}"]`);
      await nowTag.waitFor();
      const expectedSec = await colourSignature(nowTag);
      await page.getByRole("button", { name: "加 Task", exact: true }).click();
      const form = page.getByRole("form", { name: "新增 Task", exact: true });
      await form.getByText("＋Tag（可選）", { exact: true }).click();
      const option = tag => form.getByRole("button", { name: tag.name, exact: true });
      const palette = new Map();
      for (const tag of tags) palette.set(tag.id, await colourSignature(option(tag)));
      assert.deepEqual(palette.get(sec.id), expectedSec, "the editor and Today card must use the same SEC colour");
      for (const i of [0, 1]) assert.equal(new Set(tags.map(tag => palette.get(tag.id)[i].surface.join(","))).size, 4);

      await option(sec).click();
      await option(wecare).click();
      for (const tag of [sec, wecare]) {
        assert.equal(await option(tag).getAttribute("aria-pressed"), "true");
        assert.equal(await option(tag).locator("svg").count(), 1, "chosen Tags need a visible non-colour checkmark");
        assert.deepEqual(await colourSignature(option(tag)), palette.get(tag.id), "selected state keeps the Tag colour");
      }
      await form.getByLabel("任務名稱", { exact: true }).fill("用兩個 Tag 新增測試");
      await form.getByRole("button", { name: "儲存任務", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Task 已儲存" }).waitFor();
      assert.equal(writes.length, 1);
      assert.deepEqual(writes[0].tagIds, [sec.id, wecare.id]);

      await page.getByRole("tab", { name: /任務總表/ }).click();
      const queue = page.locator("#task-action-list");
      const filters = queue.getByRole("region", { name: "選擇任務 Tags", exact: true });
      const filter = tag => filters.getByRole("button", { name: new RegExp(`^${tag.name}\\s*\\d+$`) });
      for (const tag of tags) assert.deepEqual(await colourSignature(filter(tag)), palette.get(tag.id));
      await filter(sec).click();
      await filter(wecare).click();
      assert.equal(await filter(sec).getAttribute("aria-pressed"), "true");
      assert.equal(await filter(wecare).getAttribute("aria-pressed"), "true");
      await queue.getByRole("button", { name: /^未完成/ }).click();
      const row = title => queue.locator(".task-queue-row").filter({ hasText: title });
      await row(tasks[0].title).waitFor();
      await row(tasks[1].title).waitFor();
      assert.equal(await row(tasks[2].title).count(), 0, "multi-select matches either chosen Tag, not unrelated records");
      assert.deepEqual(await colourSignature(row(tasks[0].title).locator(`[data-tag-id="${sec.id}"]`)), palette.get(sec.id));
      await filter(sec).click();
      assert.equal(await row(tasks[0].title).count(), 0, "tapping a selected filter removes only that Tag");
      await row(tasks[1].title).waitFor();
      await filters.getByRole("button", { name: "未分類", exact: true }).click();
      await row(tasks[4].title).waitFor();
      assert.equal(await row(tasks[1].title).count(), 0);
      await filters.getByRole("button", { name: "全部", exact: true }).click();
      await row(tasks[2].title).waitFor();
      for (const tag of tags) {
        assert.equal(await filter(tag).getAttribute("aria-pressed"), "true", "All checks every visible Tag");
        assert.equal(await filter(tag).locator("svg").isVisible(), true, "All shows a visible checkmark");
      }
      const showRemaining = queue.getByRole("button", { name: /^顯示全部（共/ });
      if (await showRemaining.isVisible()) await showRemaining.click();
      await row(tasks[4].title).waitFor();
      await filter(sec).click();
      assert.equal(await filter(sec).getAttribute("aria-pressed"), "false");
      assert.equal(await filter(wecare).getAttribute("aria-pressed"), "true");
      assert.equal(await row(tasks[0].title).count(), 0, "unchecking from All removes SEC-only tasks");
      await row("用兩個 Tag 新增測試").waitFor();
      assert.equal(await row(tasks[4].title).count(), 0, "the narrowed filter now only matches selected Tags");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "filters must fit the viewport");
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: two Tags submitted, All visibly checks Tags, multi-filter OR, consistent light/dark colours`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
