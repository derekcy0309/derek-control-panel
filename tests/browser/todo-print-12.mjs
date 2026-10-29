// Reproduce 12 ordered tasks and print to PDF, using synthetic data only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = 'http://localhost:3139';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date());
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '-p', '3139'], { env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-mock', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; server.stdout.on('data', chunk => { logs += chunk; }); server.stderr.on('data', chunk => { logs += chunk; });
let browser;
try {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(logs.slice(-2000));
    try { if ((await fetch(`${base}/api/auth`)).status === 401) break; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const userId = '11111111-1111-4111-8111-111111111111';
    const tasks = Array.from({ length: 12 }, (_, index) => ({ id: `task-${index}`, title: index === 3 ? '第 4 項：這是一項較長的測試工作名稱，用來驗證在 A4 列印時會自動換行而不會被剪斷' : `測試工作 ${index + 1}`, user_id: userId, owner_id: userId, scope: 'home', area: index % 2 ? 'family' : 'personal', status: 'not_started', due_date: index % 3 ? null : today, next_action: '打開測試文件並完成第一小步', deleted_at: null, archived_at: null, created_at: `${today}T00:00:00Z`, updated_at: `${today}T00:00:00Z` }));
    const planning = tasks.map((task, index) => ({ user_id: userId, resource_type: 'task', resource_id: task.id, planned_date: today, plan_role: index === 0 ? 'now' : 'later', plan_source: 'manual', plan_position: index + 1 }));
    await page.route('**/api/**', async route => {
      const request = route.request();
      assert.equal(request.method(), 'GET');
      const url = new URL(request.url());
      if (url.pathname === '/api/auth') return route.fulfill({ json: { user: { id: userId } } });
      await route.fulfill({ json: { currentUser: { id: userId, email: 'test@example.test', displayName: '測試用戶' }, profile: { user_id: userId, active: true, workspace_role: 'derek' }, settings: {}, tasks, taskQueueCatalog: tasks, taskCatalog: tasks, planning, taskDependencies: [], assignments: [], currentUserId: userId, quietModeUntil: null } });
    });
    await page.goto(`${base}/todo-list`);
    const paper = page.getByRole('region', { name: 'To-do List 紙本預覽' });
    await page.getByRole('button', { name: '列印／儲存 PDF（12）', exact: true }).waitFor();
    assert.equal(await paper.locator('article').count(), 12);
    const headings = await paper.locator('article h4').allTextContents();
    assert.ok(headings[0].startsWith('1. 測試工作 1'));
    assert.ok(headings[11].startsWith('12. 測試工作 12'));
    // Simulate a printer dialog that overrides page margins to "none".
    await page.addStyleTag({ content: '@page { size: A4 portrait; margin: 0 !important; }' });
    const path = width === 390 ? process.env.PRINT_MOBILE_PDF : process.env.PRINT_DESKTOP_PDF;
    if (path) await page.pdf({ path, format: 'A4', preferCSSPageSize: true, printBackground: false });
    console.log(`PASS ${width}px: 12 ordered tasks, A4 PDF`);
    await context.close();
  }
} catch (error) { console.error(logs.slice(-2000)); throw error; }
finally { await browser?.close(); server.kill(); }
