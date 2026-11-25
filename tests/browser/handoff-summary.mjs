// Run against a local Next.js server; every API response is synthetic and writes are blocked.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const origin = new URL(process.env.VERIFY_URL || "http://127.0.0.1:3219").origin;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const id = n => "65000000-0000-4000-8000-" + String(n).padStart(12, "0");
const sender = { id: id(1), displayName: "Derek", email: "sender@example.test" };
const recipient = { id: id(2), displayName: "Suki", email: "recipient@example.test" };
const observer = { id: id(3), displayName: "Amigo", email: "observer@example.test" };
const people = [sender, recipient, observer];
const task = { id: id(10), title: "測試文件回覆", status: "waiting", next_action: "查看已確認回覆", waiting_for: "文件負責人", waiting_on: "文件確認", follow_up_date: "2026-12-01", owner_id: sender.id, user_id: sender.id, progress: 20 };
const closedTask = { ...task, id: id(20), title: "已完成的舊工作", status: "done", current_step_status: "waiting" };
const pending = { id: id(41), resource_type: "task", resource_id: task.id, assigned_by_id: sender.id, assigned_to_id: recipient.id, acknowledged_at: "2026-11-26T03:00:00Z", status: "pending_acceptance", created_at: "2026-11-26T02:00:00Z" };
const closed = { ...pending, id: id(42), resource_id: closedTask.id, status: "closed" };
const history = { ...pending, id: id(43), status: "completed", created_at: "2026-11-26T03:30:00Z" };
try {
  for (const [width, viewer] of [[360, recipient], [1280, sender], [390, observer]]) {
    const context = await browser.newContext({ viewport: { width, height: 840 }, timezoneId: "Asia/Hong_Kong", locale: "zh-HK", serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(35000);
      const writes = [], errors = [];
      const hasRecords = viewer !== observer;
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (!["GET", "HEAD"].includes(request.method())) {
          if (url.pathname.startsWith("/api/")) writes.push(request.method() + " " + url.pathname);
          return route.abort();
        }
        if (!url.pathname.startsWith("/api/")) return route.continue();
        let json = {};
        if (url.pathname === "/api/auth") json = { user: { id: viewer.id } };
        else if (url.pathname === "/api/control") {
          json = url.searchParams.get("view") === "assignment_alerts" ? { currentUserId: viewer.id, assignments: [], quietModeUntil: null } : {
            currentUser: viewer, profile: { user_id: viewer.id, display_name: viewer.displayName, active: true, is_admin: false }, settings: { theme: "light" },
            participants: people.map(p => ({ user_id: p.id, display_name: p.displayName })),
            tasks: hasRecords ? [task, closedTask] : [], assignments: hasRecords ? [history, pending, closed] : [], handoffNotes: [], shares: [], operatingItems: [],
            taskFollowers: [], taskDependencies: [], reminders: [], taskNoticeRecipients: [], notificationPreferences: null, planning: []
          };
        }
        return route.fulfill({ json });
      });
      await page.goto(origin + "/sharing", { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "分享及交辦中心" }).waitFor();
      for (const location of ["history", "waiting"]) {
        if (location === "waiting") {
          await page.goto(origin + "/workspace/waiting", { waitUntil: "domcontentloaded" });
          await page.getByRole("heading", { name: "等待清單" }).waitFor();
        }
        if (hasRecords) {
          const card = page.locator("article").filter({ has: page.getByRole("heading", { name: task.title }) });
          await card.getByText(viewer === recipient ? "待你決定是否接受" : "待Suki決定是否接受", { exact: true }).waitFor();
          await card.getByText("已確認收悉，尚未接受", { exact: true }).waitFor();
          assert.match(await card.innerText(), /2026-12-01/);
          assert.doesNotMatch(await card.innerText(), /此段交接已完成/);
          if (location === "waiting") {
            assert.equal(await page.getByRole("heading", { name: closedTask.title }).count(), 0);
            await card.getByText("文件負責人", { exact: true }).waitFor();
          } else {
            await page.locator("article").filter({ has: page.getByRole("heading", { name: closedTask.title }) }).getByText("毋須跟進").waitFor();
          }
        } else {
          await page.getByRole("heading", { name: location === "waiting" ? "目前沒有等待中的工作" : "暫時未有交接工作" }).waitFor();
          assert.equal(await page.getByText(task.title, { exact: true }).count(), 0);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "page must fit viewport");
      }
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
      console.log(`PASS: ${width}px, ${viewer.displayName}, history + waiting, no API mutations`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
