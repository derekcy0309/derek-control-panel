// Browser verification with mock API responses only; never writes real tasks.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
if (!process.env.VERIFY_URL) throw new Error('VERIFY_URL required');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const userId = '11111111-1111-4111-8111-111111111111';
    const ids = ['22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222223'];
    const tasks = ids.map((id, i) => ({ id, title: `測試任務${i + 1}`, user_id: userId, owner_id: userId, scope: 'home', area: 'personal', source_type: 'follow_up', owner: null, due_date: null, follow_up_date: null, status: 'not_started', next_action: null, risk: 'low', notes: null, completed_at: null, deleted_at: null, archived_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), requested_priority: 3 }));
    let planning = ids.map((id, i) => ({ user_id: userId, resource_type: 'task', resource_id: id, planned_date: today, plan_role: i === 0 ? 'now' : 'later', plan_source: 'manual', plan_position: i + 1, hidden_from_today: false, personal_priority: 3 }));
    let saves = 0;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const snapshot = () => ({ currentUser: { id: userId, email: 'test@example.test', displayName: '測試' }, profile: { user_id: userId, display_name: '測試', workspace_role: 'derek', active: true, is_admin: false, must_change_password: false }, settings: { user_id: userId, gentle_mode: false, wip_limit: 3, theme: 'light' }, tasks, taskCatalog: tasks, taskQueueCatalog: tasks, planning, assignments: [], shares: [], participants: [{ user_id: userId, display_name: '測試' }], taskDependencies: [], capacityCommitments: [], weeklyAvailableMinutes: null, reminders: [], notificationPreferences: null, cashflowHint: null, capacity: null, taskFollowers: [], taskNoticeRecipients: [] });
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url());
      let body = {};
      if (path.pathname === '/api/auth') body = { user: { id: userId } };
      else if (path.pathname === '/api/control' && request.method() === 'GET') body = path.searchParams.get('view') === 'assignment_alerts' ? { assignments: [], currentUserId: userId, quietModeUntil: null } : snapshot();
      else if (path.pathname === '/api/control' && request.method() === 'POST') {
        const input = request.postDataJSON();
        assert.equal(input.action, 'reorder_today_tasks');
        saves++;
        planning = input.taskIds.map((id, i) => ({ ...planning.find(item => item.resource_id === id), plan_role: i === 0 ? 'now' : 'later', plan_position: i + 1 }));
        body = { ok: true };
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(process.env.VERIFY_URL, { waitUntil: 'domcontentloaded' });
    page.setDefaultTimeout(12000);
    await page.getByRole('tab', { name: /今日全部/ }).waitFor().catch(async error => { console.log('Rendered view:', (await page.locator('body').innerText()).slice(0, 1200)); console.log('Page errors:', errors); throw error; });
    await page.getByRole('tab', { name: /今日全部/ }).click();
    await page.getByRole('button', { name: '安排今日次序' }).click();
    await page.getByLabel('將測試任務3排到第幾位').selectOption('0');
    assert.equal(saves, 0, 'changing positions must not save');
    const orderPanel = page.getByRole('region', { name: '安排今日次序' });
    assert.deepEqual(await orderPanel.locator('li').allTextContents().then(items => items.map(item => item.match(/測試任務\d/)[0])), ['測試任務3', '測試任務1', '測試任務2']);
    await page.getByRole('button', { name: '儲存次序' }).click();
    await page.getByRole('status').filter({ hasText: '今日任務已按你揀的次序排列' }).waitFor();
    assert.equal(saves, 1);
    assert.deepEqual(planning.map(item => item.resource_id), [ids[2], ids[0], ids[1]]);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Today reorder verified at ${width}px with mocked data`);
  }
} finally { await browser.close(); }
