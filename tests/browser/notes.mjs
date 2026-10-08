// All application APIs are mocked. This script never writes live user data.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.VERIFY_URL;
if (!base) throw new Error('VERIFY_URL required');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
try {
  for (const role of ['derek', 'suki', 'amigo']) for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const userId = '11111111-1111-4111-8111-111111111111';
    const note = (id, title) => ({ id, item_type: 'note', title, description: '第一行\n第二行：舊有資料', owner_id: userId, created_by_id: userId, area: 'personal', status: 'completed', due_date: '2020-01-01', next_action: '舊有下一步', sensitive: true, visibility: 'private', metadata: { noteCategory: '車輛', originalSource: 'inbox' }, archived_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-08T00:00:00Z' });
    const items = [note('22222222-2222-4222-8222-222222222222', '舊筆記'), { ...note('44444444-4444-4444-8444-444444444444', '他人的筆記'), owner_id: 'someone-else' }];
    let failed = false;
    let createBody;
    let updateBody;
    let writes = 0;
    const snapshot = () => ({ currentUser: { id: userId, email: `${role}@example.test`, displayName: role }, profile: { user_id: userId, display_name: role, workspace_role: role, active: true, is_admin: false, must_change_password: false }, settings: { user_id: userId, theme: 'light', show_encouragement: false }, operatingItems: items, tasks: [], transactions: [], recurringExpenseRules: [], recurringIncomeRules: [], meetings: [], balances: [], shares: [], assignments: [], handoffNotes: [], planning: [], capacity: null, participants: [], taskDependencies: [], projectMilestones: [], taskRecurrenceRules: [], notificationPreferences: null, notificationDeliveries: [], activePushSubscriptionCount: 0, household: null, calendarConnections: [], taskNoticeRecipients: [], taskFollowers: [] });
    await page.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      let body = {};
      if (url.pathname === '/api/auth') body = { user: { id: userId } };
      else if (url.pathname === '/api/control' && request.method() === 'GET') body = url.searchParams.get('view') === 'assignment_alerts' ? { assignments: [], currentUserId: userId, quietModeUntil: null } : snapshot();
      else if (url.pathname === '/api/control' && request.method() === 'POST') {
        writes++;
        const input = request.postDataJSON();
        if (input.action === 'create_item') {
          createBody = input;
          if (!failed) {
            failed = true;
            await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '測試暫時未能儲存，請重試。' }) });
            return;
          }
          const created = { ...note('33333333-3333-4333-8333-333333333333', input.title), description: input.description, status: 'active', due_date: null, next_action: null, metadata: { noteCategory: input.noteCategory } };
          items.push(created);
          body = { item: created };
        } else if (input.action === 'update_item') {
          updateBody = input;
          const target = items.find(item => item.id === input.id);
          Object.assign(target, input.changes);
          target.metadata = { ...target.metadata, noteCategory: input.noteCategory };
          body = { item: target };
        } else throw new Error(`Unexpected write: ${input.action}`);
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(new URL('/workspace/note', base).href, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '打開筆記：舊筆記', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '打開筆記：他人的筆記', exact: true }).count(), 0);
    assert.equal(await page.getByLabel('狀態', { exact: true }).count(), 0);
    await page.getByRole('button', { name: '新增筆記', exact: true }).first().click();
    let dialog = page.getByRole('dialog', { name: '新增筆記', exact: true });
    assert.equal(await dialog.locator('input[type=date]').count(), 0);
    assert.equal(await dialog.getByText('清晰下一步', { exact: true }).count(), 0);
    assert.equal(await dialog.getByText('系統狀態', { exact: true }).count(), 0);
    await dialog.getByLabel('標題', { exact: true }).fill('測試財務筆記');
    await dialog.getByLabel('內容', { exact: true }).fill('純粹記事，不是收入或支出。');
    await dialog.getByLabel('分類／Remark（可留空）', { exact: true }).fill('個人財務');
    await dialog.getByRole('button', { name: '返回', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '新增筆記', exact: true }).first().click();
    await dialog.getByRole('status').filter({ hasText: '已恢復' }).waitFor();
    assert.equal(await dialog.getByLabel('內容', { exact: true }).inputValue(), '純粹記事，不是收入或支出。');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '打開筆記：舊筆記', exact: true }).waitFor();
    await page.getByRole('button', { name: '新增筆記', exact: true }).first().click();
    await dialog.getByRole('status').filter({ hasText: '已恢復' }).waitFor();
    assert.equal(await dialog.getByLabel('標題', { exact: true }).inputValue(), '測試財務筆記');
    const writesBeforeOffline = writes;
    await context.setOffline(true);
    await dialog.getByRole('button', { name: '儲存筆記', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: '目前未連線' }).waitFor();
    assert.equal(writes, writesBeforeOffline);
    await context.setOffline(false);
    await dialog.getByRole('button', { name: '儲存筆記', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: '測試暫時未能儲存' }).waitFor();
    let navigations = 0;
    page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; });
    await dialog.getByRole('button', { name: '儲存筆記', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '打開筆記：測試財務筆記', exact: true }).waitFor();
    assert.equal(createBody.area, 'personal');
    assert.equal(createBody.noteCategory, '個人財務');
    for (const field of ['dueDate', 'nextAction', 'status', 'visibility']) assert.equal(field in createBody, false);
    await page.getByLabel('筆記分類', { exact: true }).selectOption('個人財務');
    assert.equal(await page.getByRole('button', { name: '打開筆記：舊筆記', exact: true }).count(), 0);
    await page.getByLabel('筆記分類', { exact: true }).selectOption('');
    await page.getByRole('button', { name: '打開筆記：舊筆記', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '修改筆記', exact: true });
    assert.equal(await dialog.locator('input[type=date]').count(), 0);
    await dialog.getByLabel('分類／Remark（可留空）', { exact: true }).fill('我的興趣');
    await dialog.getByRole('button', { name: '儲存筆記', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(Object.keys(updateBody.changes).sort(), ['description', 'title']);
    assert.equal(items[0].due_date, '2020-01-01');
    assert.equal(items[0].status, 'completed');
    assert.equal(items[0].metadata.originalSource, 'inbox');
    await page.getByLabel('筆記分類', { exact: true }).selectOption('我的興趣');
    await page.getByLabel('搜尋此頁', { exact: true }).fill('第二行');
    await page.getByRole('button', { name: '打開筆記：舊筆記', exact: true }).waitFor();
    assert.equal(navigations, 0);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (process.env.SCREENSHOT_DIR && role === 'derek' && width === 390) {
      await page.getByRole('button', { name: '打開筆記：舊筆記', exact: true }).click();
      await page.getByRole('dialog', { name: '修改筆記', exact: true }).screenshot({ path: `${process.env.SCREENSHOT_DIR}/notes-mobile.png` });
    }
    console.log(`${role} ${width}px: simple notes, category/search, draft restore, offline/error retry, legacy data preserved, no reload PASS`);
    await context.close();
  }
} finally { await browser.close(); }
