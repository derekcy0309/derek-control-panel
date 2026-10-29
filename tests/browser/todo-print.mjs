// All account/data APIs are mocked. No production reads or writes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = 'http://localhost:3139';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date());
let logs = '';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '-p', '3139'], { env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-mock', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', chunk => { logs += chunk; }); server.stderr.on('data', chunk => { logs += chunk; });
let browser;
try {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(logs.slice(-2000));
    try { if ((await fetch(`${base}/api/auth`)).status === 401) break; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  for (const role of ['Derek', 'Suki', 'Amigo']) for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.__printCount = 0; window.print = () => { window.__printCount++; }; });
    const userId = '11111111-1111-4111-8111-111111111111';
    const tasks = Array.from({ length: 45 }, (_, index) => ({ id: `task-${index}`, title: index === 1 ? '整理本週文件，核對資料後再保存到正確的資料夾，以便下次可以直接繼續處理' : `待辦工作 ${index + 1}`, user_id: userId, owner_id: userId, scope: 'home', area: index < 3 ? 'personal' : index < 5 ? 'family' : 'work', status: index === 44 ? 'waiting' : index === 43 ? 'done' : 'not_started', due_date: index === 0 ? null : today, next_action: '先打開需要使用的文件', current_step_title: index === 0 ? '先用 5 分鐘整理第一頁' : null, notes: 'PRIVATE-NOTES-MUST-NOT-PRINT', deleted_at: null, archived_at: null, created_at: `${today}T00:00:00Z`, updated_at: `${today}T00:00:00Z` }));
    let empty = false; let fail = false; let writes = 0;
    const order = [3, 0, 4, 1, 2]; // Family and personal alternate; grouping must never change this order.
    const planning = order.map((id, index) => ({ user_id: userId, resource_type: 'task', resource_id: `task-${id}`, planned_date: today, plan_role: index === 0 ? 'now' : 'later', plan_source: 'manual', plan_position: index + 1 }));
    await page.route('**/api/**', async route => {
      if (route.request().method() !== 'GET') writes++;
      const url = new URL(route.request().url());
      if (url.pathname === '/api/auth') return route.fulfill({ json: { user: { id: userId } } });
      if (url.searchParams.get('view') === 'today' && fail) return route.fulfill({ status: 503, json: { error: '測試網絡錯誤，請重試。' } });
      await route.fulfill({ json: { currentUser: { id: userId, email: 'test@example.test', displayName: role }, profile: { user_id: userId, active: true, workspace_role: role.toLowerCase() }, settings: {}, tasks, taskQueueCatalog: tasks, taskCatalog: tasks, planning: empty ? [] : planning, taskDependencies: [], assignments: [], currentUserId: userId, quietModeUntil: null } });
    });
    await page.goto(`${base}/todo-list`);
    const paper = page.getByRole('region', { name: 'To-do List 紙本預覽' });
    await page.getByRole('button', { name: '列印／儲存 PDF（5）', exact: true }).waitFor();
    assert.equal(await paper.locator('article').count(), 5);
    assert.deepEqual(await paper.locator('article h4').allTextContents(), [
      '1. 待辦工作 4', '2. 待辦工作 1', '3. 待辦工作 5',
      '4. 整理本週文件，核對資料後再保存到正確的資料夾，以便下次可以直接繼續處理', '5. 待辦工作 3'
    ]);
    assert.equal(await paper.getByText('____：____ 至 ____：____', { exact: true }).count(), 5);
    assert.equal(await paper.getByText('PRIVATE-NOTES-MUST-NOT-PRINT').count(), 0);
    assert.equal(await paper.getByText('先用 5 分鐘整理第一頁', { exact: false }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (role === 'Derek' && width === 390 && process.env.PRINT_MOBILE_SCREENSHOT) await page.screenshot({ path: process.env.PRINT_MOBILE_SCREENSHOT, fullPage: true });
    await page.getByRole('button', { name: '列印／儲存 PDF（5）', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__printCount), 1);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.getByRole('heading', { name: '列印 To-do List', exact: true }).isVisible(), false);
    assert.equal(await page.getByRole('banner').isVisible(), false);
    assert.equal(await paper.isVisible(), true);
    assert.deepEqual(await paper.locator('article h4').allTextContents(), [
      '1. 待辦工作 4', '2. 待辦工作 1', '3. 待辦工作 5',
      '4. 整理本週文件，核對資料後再保存到正確的資料夾，以便下次可以直接繼續處理', '5. 待辦工作 3'
    ]);
    const padding = await paper.evaluate(element => getComputedStyle(element.closest('.app-frame > div')).paddingLeft);
    assert.equal(padding, '0px', 'navigation padding must not shrink print output');
    if (role === 'Derek' && width === 1280 && process.env.PRINT_PDF) await page.pdf({ path: process.env.PRINT_PDF, format: 'A4', preferCSSPageSize: true, printBackground: false });
    await page.emulateMedia({ media: 'screen' });
    await page.getByRole('button', { name: '自行揀選任務', exact: true }).click();
    const printEmpty = page.getByRole('button', { name: '列印／儲存 PDF（0）', exact: true });
    assert.equal(await printEmpty.isDisabled(), true);
    assert.equal(await page.getByRole('checkbox').count(), 20);
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: '下一頁', exact: true }).click();
    await page.getByRole('checkbox').first().check();
    assert.equal(await paper.locator('article').count(), 2);
    await page.getByLabel('分類', { exact: true }).selectOption('family');
    assert.equal(await paper.locator('article').count(), 2); // Selection survives filters.
    await page.locator('input[type="checkbox"]:not(:checked)').first().check();
    assert.equal(await paper.locator('article').count(), 3);
    await page.getByRole('button', { name: '清除選取', exact: true }).click();
    assert.equal(await paper.locator('article').count(), 0);
    empty = true;
    await page.reload();
    await page.getByText('今日未有已安排的待辦工作。', { exact: false }).waitFor();
    assert.equal(await printEmpty.isDisabled(), true);
    fail = true;
    await page.reload();
    await page.getByRole('heading', { name: '未能載入 To-do List', exact: true }).waitFor();
    fail = false;
    await page.getByRole('button', { name: '重新嘗試', exact: true }).click();
    await page.getByText('今日未有已安排的待辦工作。', { exact: false }).waitFor();
    assert.equal(writes, 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${role} ${width}px: today, handwritten slots, next steps, selection/pagination, A4 media, empty/error/retry, zero mutations`);
    await context.close();
  }
} catch (error) { console.error(logs.slice(-2000)); throw error; }
finally { await browser?.close(); server.kill(); }
