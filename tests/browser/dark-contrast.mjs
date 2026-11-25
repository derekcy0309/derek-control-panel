// Real app CSS and navigation; API calls served only by isolated browser fixtures.
// VERIFY_URL=http://localhost:3145, PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE as needed.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const origin = new URL(process.env.VERIFY_URL || "http://localhost:3145").origin;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Use only a loopback dev build.");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const owner = "53000000-0000-4000-8000-000000000001";
const noteId = "53000000-0000-4000-8000-000000000002", taskId = "53000000-0000-4000-8000-000000000003";
const now = "2026-11-25T01:00:00Z", date = "2026-11-25";
const user = { id: owner, displayName: "深色版測試", email: "dayline@example.test" };
const task = {
  id: taskId, user_id: owner, owner_id: owner, title: "測試任務", next_action: "核對顏色", status: "not_started",
  scope: "home", area: "personal", source_type: "follow_up", requested_priority: 1, due_date: date,
  created_at: now, updated_at: now, archived_at: null, deleted_at: null, personal_tag_ids: []
};
const note = {
  id: noteId, owner_id: owner, created_by_id: owner, title: "測試筆記", description: "隔離用嘅筆記內容。",
  item_type: "note", visibility: "private", area: "personal", status: "active", metadata: { noteCategory: "測試分類" },
  created_at: now, updated_at: now, archived_at: null
};
const transaction = {
  id: "53000000-0000-4000-8000-000000000004", user_id: owner, owner_id: owner, type: "expense", scope: "home",
  item: "測試支出", category: "其他", amount: 150, actual_date: "2026-12-01", archived_at: null,
  created_at: now, updated_at: now
};
const participants = [{ user_id: owner, display_name: user.displayName }];
const bootstrap = {
  currentUser: user, participants, profile: { user_id: owner, active: true, is_admin: true, workspace_role: "derek", timezone: "Asia/Hong_Kong" },
  settings: { theme: "night_shift", focus_minutes: 25, visual_intensity: "balanced", accent_colour: "indigo" },
  tasks: [task], taskQueueCatalog: [task], taskCatalog: [task], taskTags: [], taskSteps: [], taskFollowers: [],
  assignments: [], shares: [], planning: [], taskNoticeRecipients: [], taskDependencies: [], reminders: [], capacityCommitments: [],
  notificationPreferences: null, notificationDeliveries: [], activePushSubscriptionCount: 0, calendarConnections: [],
  operatingItems: [note], transactions: [transaction], recurringExpenseRules: [], recurringIncomeRules: [], balances: [], meetings: []
};

async function prepare(page) {
  const writes = [], pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    const path = url.pathname, view = url.searchParams.get("view"), kind = url.searchParams.get("kind");
    if (!["GET", "HEAD"].includes(request.method())) {
      if (path.startsWith("/api/")) writes.push(path);
      return route.abort();
    }
    if (!path.startsWith("/api/")) return route.continue();
    let json = {};
    if (path === "/api/auth") json = { user: { id: owner } };
    else if (path === "/api/control") {
      if (view === "assignment_alerts") json = { assignments: [], currentUserId: owner, quietModeUntil: null };
      else if (view === "calendar") json = { month: url.searchParams.get("month"), currentUser: user, participants,
        tasks: [task], operatingItems: [], meetings: [], assignments: [], calendarConnections: [] };
      else if (view === "task_tags") json = { taskTagIds: [], tags: [] };
      else if (view === "task_detail") json = { ...bootstrap, task, parentTask: null, childTasks: [], handoffNotes: [], activityLogs: [], taskRecurrenceRules: [] };
      else if (view === "work_guide") json = { steps: [], checkpoint: null, openChildren: false };
      else if (view === "task_checkpoints") json = { checkpoints: [], latest: null };
      else if (view === "task_resources") json = { resources: [], options: [] };
      else if (view === "focus_sessions") json = { sessions: [] };
      else json = bootstrap;
    } else if (path === "/api/calendar-brief") json = {
      from: date, untilExclusive: "2026-11-28", generatedAt: now, familyDates: [], sources: [],
      days: [{ date, events: [], deadlines: [{ id: taskId, title: task.title, due: date, priority: 1, status: task.status }] }]
    };
    else if (path === "/api/apple-calendar-month") json = {
      month: "2026-11", from: "2026-10-26", until: "2026-12-07", events: [], source: { state: "not_connected" }
    };
    else if (path === "/api/information") json = { prefs: { journals: false, news: false, traffic: false }, routes: [] };
    else if (path === "/api/start-links") json = { links: [], shortcuts: [], ownerId: owner };
    else if (path === "/api/weather/hong-kong") json = { observed: { temperature: 21, icon: 50, at: now }, forecast: [], warnings: [], checkedAt: now };
    else if (path === "/api/agent-access") json = { grants: [], events: [], tasks: [task], notes: [note], tags: [] };
    else if (path === "/api/agent-access/archive-requests") json = { requests: [] };
    else if (path === "/api/agent") {
      if (view === "list") json = { items: [kind === "note" ? { ...note, kind: "note" } : { ...task, kind: "task" }], nextOffset: null };
      else if (view === "detail") json = { item: kind === "note" ? { ...note, kind: "note" } : { ...task, kind: "task" } };
      else json = { id: owner, label: "深色 Agent 工作區", scope: "owner_workspace", tags: [], expiresAt: now,
        permissions: { read: true, create: true, update: true, delete: false, requestArchive: true } };
    } else if (path === "/api/school-bot-review") json = { grants: [], pending: [], more: false };
    else if (path === "/api/agent-access/personal") json = { connected: false, pending: [] };
    else if (path === "/api/integrations/google-calendar") json = { connections: [], accountHints: { personal: "", family: "", work: "" } };
    else if (path === "/api/integrations/apple-calendar") json = { connection: null, grants: [] };
    return route.fulfill({ json, status: 200 });
  });
  return { writes, pageErrors };
}

async function measure(page, { baseline = false, selector = "main", filterText } = {}) {
  return page.evaluate(({ baseline, selector, filterText }) => {
    // Next may concatenate the CSS into app/layout.css. Disable only the media
    // block with the global contrast palette to compare the same rendered UI.
    const sheets = [...document.styleSheets];
    const appendix = sheets.flatMap(sheet => {
      try { return [...sheet.cssRules]; } catch { return []; }
    }).find(rule => rule instanceof CSSMediaRule && rule.cssText.includes("--contrast-control:"));
    if (baseline && !appendix) return null;
    const originalMedia = appendix?.media.mediaText;
    if (baseline) appendix.media.mediaText = "not all";
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const px = canvas.getContext("2d", { willReadFrequently: true });
      const cache = new Map();
      const rgba = color => {
        if (cache.has(color)) return cache.get(color);
        px.clearRect(0, 0, 1, 1);
        px.fillStyle = color;
        px.fillRect(0, 0, 1, 1);
        const data = Array.from(px.getImageData(0, 0, 1, 1).data, (x, i) => i === 3 ? x / 255 : x);
        cache.set(color, data);
        return data;
      };
      const over = (below, above) => [...below.slice(0, 3).map((x, i) => x * (1 - above[3]) + above[i] * above[3]), 1];
      const luminance = c => c.slice(0, 3).map(x => x / 255)
        .map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
        .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (a, b) => {
        const x = luminance(a), y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const background = el => {
        const layers = [];
        for (let p = el; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          // Do not guess pixels of art or gradients. Important pure-colour
          // surfaces (forms, badges, controls) will still have a solid base.
          if (s.backgroundImage !== "none") return null;
          const color = rgba(s.backgroundColor);
          if (color[3] > 0) layers.push(color);
          if (color[3] >= 0.999 || p === document.body) break;
        }
        return layers.reverse().reduce(over, [255, 255, 255, 1]);
      };
      const root = document.querySelector(selector);
      if (!root) return [];
      const rows = [];
      for (const el of root.querySelectorAll("*")) {
        if (!(el instanceof HTMLElement) || ["SCRIPT", "NOSCRIPT", "STYLE", "OPTION"].includes(el.tagName)
            || el.closest("[hidden],[aria-hidden='true'],.sr-only,[disabled],:disabled")) continue;
        const inputs = ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
        const placeholder = inputs && !el.value && el.placeholder;
        if (inputs && !placeholder && !el.value) continue;
        if (inputs && ["checkbox", "radio", "hidden"].includes(el.type)) continue;
        const value = inputs ? placeholder || (el instanceof HTMLSelectElement ? el.selectedOptions[0]?.textContent : el.value)
          : [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(" ").trim();
        if (!value || (filterText && !value.includes(filterText))) continue;
        const b = el.getBoundingClientRect(), style = getComputedStyle(el);
        if (b.width < 4 || b.height < 4 || style.visibility !== "visible" || style.display === "none") continue;
        const backdrop = background(el);
        if (!backdrop) continue;
        const foreground = rgba(placeholder ? getComputedStyle(el, "::placeholder").color : style.color).slice();
        let opacity = 1;
        for (let p = el; p && p !== root; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity);
        if (opacity < 0.05) continue;
        foreground[3] *= opacity;
        const control = el.closest("button,a,input,textarea,select,summary");
        const raw = ratio(over(backdrop, foreground), backdrop);
        const large = Number.parseFloat(style.fontSize) >= (Number(style.fontWeight) >= 700 ? 18.66 : 24);
        rows.push({
          text: value.slice(0, 70), score: Number(raw.toFixed(2)), threshold: large ? 3 : 4.5,
          color: style.color, background: backdrop.slice(0, 3).map(Math.round), opacity,
          className: String(el.className).slice(0, 155), control: control?.tagName.toLowerCase() || "",
        });
      }
      return rows;
    } finally {
      if (baseline) appendix.media.mediaText = originalMedia;
    }
  }, { baseline, selector, filterText });
}

const checks = [
  { path: "/", heading: /今日總覽/ },
  { path: "/#task-action-list", heading: /^我的任務$/, open: /^未完成/ },
  { path: "/tasks/" + taskId, heading: /完整任務內容/ },
  { path: "/calendar", heading: /^日曆$/, open: /^新增日程$/ },
  { path: "/cashflow", heading: /現金流/, open: /^新增恆常支出$/ },
  { path: "/workspace/note", heading: /筆記/, open: /新增筆記/ },
  { path: "/settings", heading: /嘅設定/ },
  { path: "/agent", heading: /^深色 Agent 工作區$/, agent: true }
];
const reportOnly = process.env.DARK_CONTRAST_REPORT === "1";
const failures = [], report = [];
let comparison = false;
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    let frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    await frame();
    // CSS transitions can briefly mix colours from both themes. Measure their
    // final state, without waiting for infinite decorative animations.
    const transitions = document.getAnimations().filter(a => a instanceof CSSTransition);
    await Promise.allSettled(transitions.map(a => a.finished));
    await frame();
  });
}
try {
  for (const width of [360, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block",
      locale: "zh-HK", timezoneId: "Asia/Hong_Kong", reducedMotion: "reduce", colorScheme: "dark" });
    try {
      const page = await context.newPage();
      const { writes, pageErrors } = await prepare(page);
      const requestedPaths = process.env.DARK_CONTRAST_PATHS?.split(",").filter(Boolean);
      for (const check of checks.filter(entry => !requestedPaths || requestedPaths.includes(entry.path))) {
        await page.goto(origin + check.path);
        // Measure final paint rather than mixtures during the initial theme
        // switch, stylesheet reload, modal entrance or a:hover interpolation.
        await page.addStyleTag({ content: "*,:before,:after{transition:none!important;animation:none!important}" });
        await page.getByRole("heading", { name: check.heading }).first().waitFor({ timeout: 12000 }).catch(async error => {
          throw new Error(error.message + "\n" + (await page.locator("body").innerText()).slice(0, 560) + "\n" + pageErrors.join("\n"));
        });
        if (check.agent) {
          // Agent workspace intentionally has no human profile/settings access.
          await page.evaluate(() => document.documentElement.dataset.theme = "dark");
        } else {
          await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
        }
        await settle(page);
        const rows = await measure(page);
        assert.ok(rows.length >= 3, `Too few visible solid-background text samples at ${width}px ${check.path}`);
        const results = [rows];
        if (check.open) {
          const button = page.getByRole("button", { name: check.open }).first();
          if (await button.count()) {
            await button.click();
            await settle(page);
            results.push(await measure(page));
          }
        }
        if (width === 1280 && !comparison) {
          const contrastBefore = await measure(page, { baseline: true });
          const same = (probe, candidate) => candidate.text === probe.text && candidate.className === probe.className;
          const enhanced = rows.map(after => [contrastBefore?.find(beforeRow => same(after, beforeRow)), after])
            .filter(([prior, after]) => prior && prior.score < after.threshold && after.score >= after.threshold)
            .sort((a, b) => a[0].score - b[0].score)[0];
          if (enhanced) {
            const [prior, after] = enhanced;
            comparison = true;
            console.log(`Before/after (same element): "${after.text}" ${prior.score} → ${after.score}:1 at ${check.path}`);
          }
        }
        const unique = [...new Map(results.flat().map(row => [row.text + "|" + row.className + "|" + row.score, row])).values()];
        const misses = unique.filter(row => row.score < row.threshold).sort((a, b) => a.score - b.score);
        report.push(`${width}px ${check.path}: ${unique.length} samples, ${misses.length} below target`);
        for (const row of misses) {
          const sample = `${width}px ${check.path} ${row.score}:1 "${row.text}" ${row.className} (${row.color} on ${row.background}, opacity ${row.opacity})`;
          failures.push(sample);
          if (reportOnly) console.log(sample);
        }
        if (process.env.DARK_CONTRAST_CHAIN) {
          const target = page.locator(process.env.DARK_CONTRAST_CHAIN).first();
          if (await target.count()) console.log("Ancestor chain", await target.evaluate(el => {
            const chain = [];
            for (let p = el; p; p = p.parentElement) {
              const css = getComputedStyle(p);
              chain.push([p.tagName, p.className, css.color, css.backgroundColor,
                css.getPropertyValue("--page"), css.getPropertyValue("--ink"), css.transitionProperty]);
            }
            return chain;
          }));
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Horizontal overflow at ${width}px ${check.path}`);
      }
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(writes, []);
    } finally { await context.close(); }
  }
  console.log(report.join("\n"));
  if (!process.env.DARK_CONTRAST_PATHS) assert.ok(comparison, "No measured before/after comparison");
  if (!reportOnly) assert.deepEqual(failures, [], "Observed non-decorative text contrast: 4.5:1 normal, 3:1 large");
} finally { await browser.close(); }
