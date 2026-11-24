import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const origin = new URL(process.env.VERIFY_URL || "http://127.0.0.1:3142").origin;
assert.equal(new URL(origin).hostname, "127.0.0.1", "Use only a local fake-account test server");
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const viewer = "11111111-1111-4111-8111-111111111111";
const taskId = "11111111-1111-4111-8111-111111111112";

try {
  const page = await browser.newPage({ viewport: { width: 360, height: 840 }, serviceWorkers: "block" });
  const queries = [];
  const traffic = [];
  const failures = [];
  page.on("pageerror", error => failures.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || route.request().method() !== "GET") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/auth") return route.fulfill({ json: { user: { id: viewer } } });
    const view = url.searchParams.get("view");
    if (url.pathname === "/api/control" && view === "search") {
      const q = url.searchParams.get("q");
      queries.push(q);
      if (q === "P1") await new Promise(resolve => setTimeout(resolve, 750));
      const tag = q === "恩海居" ? "SEC" : q;
      return route.fulfill({ json: { results: [{ id: taskId, resourceType: "task", itemType: "task", status: "not_started", title: q === "P1" ? "舊回應唔應覆蓋" : "任務名稱並無 Tag 字眼", matchedTags: [tag] }] } });
    }
    traffic.push(view);
    return route.fulfill({ json: {
      currentUser: { id: viewer, displayName: "假帳戶" },
      profile: { active: true, is_admin: false, must_change_password: false },
      settings: { theme: "light", pinned_pages: [] },
      tasks: [], taskQueueCatalog: [], assignments: [], currentUserId: viewer
    } });
  });
  await page.goto(origin + "/search");
  const search = page.getByRole("searchbox", { name: /搜尋任務/ });
  await search.fill("P1");
  for (let i = 0; i < 30 && !queries.includes("P1"); i++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(queries, ["P1"]);
  const oldResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get("q") === "P1");
  await search.fill("恩海居");
  const match = page.getByRole("link", { name: "任務名稱並無 Tag 字眼" });
  await match.waitFor();
  assert.equal(await match.getAttribute("href"), "/tasks/" + taskId);
  await page.getByText("Tag：SEC", { exact: true }).waitFor();
  await oldResponse;
  assert.equal(await page.getByText("舊回應唔應覆蓋").count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(queries, ["P1", "恩海居"]);
  assert.deepEqual(failures, []);
  assert.ok(traffic.includes("shell"), "signed-in shell should use narrow request");
  console.log("PASS mobile global search: private tag label, SEC alias, task link, stale response ignored");
} finally { await browser.close(); }
