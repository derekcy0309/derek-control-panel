// Browser regression: all API calls are mocked; never writes live tasks.
// VERIFY_URL, optional PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE; see docs/task-work-day-picker-fix.md.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const url = process.env.VERIFY_URL;
if (!url) throw new Error('VERIFY_URL required');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
try {
  for (const role of ['derek', 'suki', 'amigo']) for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const userId = '11111111-1111-4111-8111-111111111111';
    const makeTask = (id, title) => ({ id, title, user_id: userId, owner_id: userId, scope: 'home', area: 'personal', source_type: 'follow_up', owner: null, due_date: null, follow_up_date: null, status: 'not_started', next_action: null, risk: 'low', notes: null, completed_at: null, deleted_at: null, archived_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), requested_priority: 3 });
    const tasks = [makeTask('22222222-2222-4222-8222-222222222222', '驗證用現有任務')];
    const planning = [];
    let failAdd = true;
    let failCreate = true;
    let createdPayload;
    let updatedPayload;
    const addToday = id => planning.push({ user_id: userId, resource_type: 'task', resource_id: id, planned_date: today, plan_role: 'later', plan_source: 'manual', plan_position: null, hidden_from_today: false, personal_priority: 3 });
    const snapshot = () => ({ currentUser: { id: userId, email: `${role}@example.test`, displayName: role }, profile: { user_id: userId, display_name: role, workspace_role: role, active: true, is_admin: false, must_change_password: false }, settings: { user_id: userId, gentle_mode: role === 'suki', wip_limit: 3, theme: 'light' }, tasks, taskCatalog: tasks, taskQueueCatalog: tasks, planning, assignments: [], shares: [], participants: [{ user_id: userId, display_name: role }], taskDependencies: [], capacityCommitments: [], weeklyAvailableMinutes: null, reminders: [], notificationPreferences: null, cashflowHint: null, capacity: null, taskFollowers: [], taskNoticeRecipients: [] });
    await page.route('**/api/**', async route => {
      const req = route.request();
      const parsed = new URL(req.url());
      let body = {};
      let status = 200;
      if (parsed.pathname === '/api/auth') body = { user: { id: userId } };
      else if (parsed.pathname === '/api/control' && req.method() === 'GET') body = parsed.searchParams.get('view') === 'assignment_alerts' ? { assignments: [], currentUserId: userId, quietModeUntil: null } : snapshot();
      else if (parsed.pathname === '/api/control' && req.method() === 'POST') {
        const input = req.postDataJSON();
        if (input.action === 'set_today_task') {
          if (failAdd) { failAdd = false; status = 503; body = { error: '驗證用暫時失敗，請重試' }; }
          else { addToday(input.taskId); body = { ok: true }; }
        } else if (input.action === 'create_task') {
          createdPayload = input;
          if (failCreate) {
            failCreate = false;
            await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '驗證用儲存失敗，請重試' }) });
            return;
          }
          const task = { ...makeTask('33333333-3333-4333-8333-333333333333', input.title), due_date: input.dueDate, work_start_date: input.workStartDate, work_dates: input.workDates };
          tasks.push(task);
          if (input.addToToday) addToday(task.id);
          status = 201; body = { task };
        } else if (input.action === 'update_task') {
          updatedPayload = input;
          const target = tasks.find(task => task.id === input.id);
          Object.assign(target, input.changes);
          body = { task: target };
        } else throw new Error(`Unexpected action: ${input.action}`);
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: /今日全部/ }).click();
    let navigations = 0;
    page.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++;
    });
    assert.equal(await page.getByRole('button', { name: '新增任務', exact: true }).count(), 1);
    await page.getByRole('button', { name: '加入現有任務', exact: true }).first().click();
    await page.getByLabel('搜尋要加入今日的任務').fill('驗證用現有');
    await page.getByRole('button', { name: '＋今日', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '驗證用暫時失敗' }).waitFor();
    await page.getByRole('button', { name: '＋今日', exact: true }).click();
    await page.getByRole('link', { name: '驗證用現有任務', exact: true }).waitFor();
    await page.getByRole('button', { name: '新增任務', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新增任務' });
    await dialog.getByLabel('任務名稱', { exact: true }).fill('驗證用今日新任務');
    assert.equal(await dialog.getByRole('checkbox', { name: /今日要做/ }).isChecked(), true);
    await dialog.getByText('自訂哪幾日做／提醒', { exact: false }).click();
    await dialog.getByLabel('任務開始日').fill(today);
    await dialog.getByLabel('加入要做的日子').fill(today);
    await dialog.getByRole('button', { name: '加入', exact: true }).click();
    await dialog.getByRole('button', { name: `移除 ${today}`, exact: true }).waitFor();
    await dialog.getByLabel('加入要做的日子').fill(today);
    await dialog.getByRole('button', { name: '加入', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: '不需要重複加入' }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: `移除 ${today}`, exact: true }).count(), 1);
    const tomorrow = new Date(`${today}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowDate = tomorrow.toISOString().slice(0, 10);
    await dialog.getByLabel('自選到期日').fill(today);
    await dialog.getByLabel('加入要做的日子').fill(tomorrowDate);
    await dialog.getByRole('button', { name: '加入', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: '不可遲過完成日' }).waitFor();
    // Removing the optional deadline must make the same selection immediately addable.
    await dialog.getByLabel('自選到期日').fill('');
    await dialog.getByRole('button', { name: '加入', exact: true }).click();
    await dialog.getByRole('button', { name: `移除 ${tomorrowDate}`, exact: true }).waitFor();
    // Changing the start must explain the conflict, never silently drop a chosen date.
    await dialog.getByLabel('任務開始日').fill(tomorrowDate);
    await dialog.getByRole('alert').filter({ hasText: '不可早過開始日' }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: `移除 ${today}`, exact: true }).count(), 1);
    await dialog.getByLabel('任務開始日').fill(today);
    await dialog.getByRole('button', { name: `移除 ${tomorrowDate}`, exact: true }).click();
    // No dates at all required before the first selection, with keyboard support.
    await dialog.getByRole('button', { name: '取消自訂工作日，恢復一般限期提醒', exact: true }).click();
    await dialog.getByRole('button', { name: '加入', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: '請先揀一個' }).waitFor();
    await dialog.getByLabel('加入要做的日子').fill(today);
    await dialog.getByLabel('加入要做的日子').press('Enter');
    assert.equal(await dialog.getByLabel('任務開始日').inputValue(), today);
    await dialog.getByRole('button', { name: `移除 ${today}`, exact: true }).waitFor();
    assert.equal(createdPayload, undefined, 'adding a date must not submit the task');
    await dialog.getByRole('button', { name: '新增任務', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: '驗證用儲存失敗' }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: `移除 ${today}`, exact: true }).count(), 1);
    await dialog.getByRole('button', { name: '新增任務', exact: true }).click();
    await page.getByRole('link', { name: '驗證用今日新任務', exact: true }).waitFor();
    assert.equal(createdPayload.addToToday, true);
    assert.deepEqual(createdPayload.workDates, [today]);
    assert.equal(createdPayload.dueDate, null);
    assert.equal(createdPayload.workStartDate, today);
    await page.getByRole('tab', { name: /任務總表/ }).click();
    await page.getByRole('button', { name: /Semi-urgent（無日期）/ }).click();
    await page.getByRole('button', { name: '修改任務：驗證用今日新任務', exact: true }).click();
    const edit = page.getByRole('dialog', { name: '修改任務' });
    await edit.getByText('自訂哪幾日做／提醒', { exact: false }).click();
    await edit.getByRole('button', { name: `移除 ${today}`, exact: true }).waitFor();
    await edit.getByLabel('加入要做的日子').fill(tomorrowDate);
    await edit.getByRole('button', { name: '加入', exact: true }).click();
    await edit.getByRole('button', { name: '儲存修改', exact: true }).click();
    await edit.waitFor({ state: 'hidden' });
    assert.deepEqual(updatedPayload.changes.work_dates, [today, tomorrowDate]);
    assert.equal(updatedPayload.changes.due_date, null);
    await page.getByRole('button', { name: '修改任務：驗證用今日新任務', exact: true }).click();
    await edit.getByText('自訂哪幾日做／提醒', { exact: false }).click();
    await edit.getByRole('button', { name: `移除 ${tomorrowDate}`, exact: true }).waitFor();
    assert.equal(navigations, 0, 'saving must not reload the page');
    assert.deepEqual(errors, []);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, 'page must fit viewport');
    console.log(`${role} ${width}px: no-deadline dates, duplicate/range feedback, keyboard add, failed-save retry, existing-task edit/readback, no reload PASS`);
    await context.close();
  }
} finally { await browser.close(); }
