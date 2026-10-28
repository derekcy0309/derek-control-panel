// Local integration harness: real Next.js routes + Supabase protocol mock.
// Does not contact Google/Supabase, sign in real users or write production data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = 'http://localhost:3138';
let scenario = 'derek';
let providerEnabled = true;
let signupDisabled = true;
let exchanges = 0;
const codes = new Map();
const ids = { derek: '11111111-1111-4111-8111-111111111111', suki: '22222222-2222-4222-8222-222222222222', amigo: '33333333-3333-4333-8333-333333333333' };
function user() { return { id: ids[scenario] ?? ids.derek, aud: 'authenticated', role: 'authenticated', email: `${scenario}@example.test`, email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'google', providers: ['email', 'google'] }, user_metadata: {}, identities: scenario === 'wrong-provider' ? [{ provider: 'email' }] : [{ provider: 'google' }] }; }
function session() {
  const payload = { sub: user().id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' };
  const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.mock`;
  return { access_token: token, refresh_token: 'local-test-refresh', token_type: 'bearer', expires_in: 3600, user: user() };
}
const backend = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4381');
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/auth/v1/settings') return res.end(JSON.stringify({ external: { google: providerEnabled }, disable_signup: signupDisabled }));
  if (url.pathname === '/auth/v1/authorize') {
    const callback = new URL(url.searchParams.get('redirect_to'));
    if (scenario === 'cancelled') callback.searchParams.set('error', 'access_denied');
    else {
      const code = `code-${codes.size}`;
      codes.set(code, url.searchParams.get('code_challenge'));
      callback.searchParams.set('code', code);
    }
    res.writeHead(303, { Location: callback.href });
    return res.end();
  }
  if (url.pathname === '/auth/v1/token') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (url.searchParams.get('grant_type') === 'pkce') {
      exchanges++;
      const expected = codes.get(body.auth_code);
      codes.delete(body.auth_code);
      if (!expected || createHash('sha256').update(body.code_verifier).digest('base64url') !== expected) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid PKCE' }));
      }
    }
    return res.end(JSON.stringify(session()));
  }
  if (url.pathname === '/auth/v1/user') return res.end(JSON.stringify(user()));
  if (url.pathname === '/auth/v1/logout') return res.end('{}');
  if (url.pathname === '/rest/v1/user_profiles') {
    assert.equal(url.searchParams.get('user_id'), `eq.${user().id}`);
    return res.end(JSON.stringify(scenario === 'missing-profile' ? null : { user_id: user().id, active: scenario !== 'inactive' }));
  }
  res.statusCode = 404; res.end('{}');
});
await new Promise(resolve => backend.listen(4381, '127.0.0.1', resolve));
let logs = '';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '-p', '3138'], { env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:4381', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-test-key', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', chunk => { logs += chunk; });
server.stderr.on('data', chunk => { logs += chunk; });
let browser;
try {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(`Next.js stopped: ${logs.slice(-3000)}`);
    try { if ((await fetch(`${base}/api/auth`)).status === 401) break; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const post = body => fetch(`${base}/api/auth/google`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/api/auth/google`, { method: 'POST', headers: { Origin: 'https://untrusted.test' }, body: '{}' })).status, 403);
  providerEnabled = false;
  let result = await post({ next: '/tasks' });
  assert.equal(result.status, 503); assert.match((await result.json()).error, /尚未完成設定/);
  providerEnabled = true; signupDisabled = false;
  result = await post({ next: '/' }); assert.equal(result.status, 503);
  signupDisabled = true;
  result = await post({ next: '//untrusted.test' });
  assert.equal(result.status, 200);
  const flowCookie = result.headers.get('set-cookie');
  assert.match(flowCookie, /HttpOnly/i); assert.match(flowCookie, /SameSite=lax/i);
  const before = exchanges;
  result = await fetch(`${base}/api/auth/google/callback?state=${'0'.repeat(64)}&code=bad`, { headers: { Cookie: flowCookie.split(';')[0] }, redirect: 'manual' });
  assert.equal(result.status, 303); assert.match(result.headers.get('location'), /login_error=expired/);
  assert.equal(exchanges, before); assert.doesNotMatch(result.headers.get('set-cookie'), /dcp_access=/);
  console.log('PASS route boundaries: CSRF, disabled provider, public signup guard, state mismatch');

  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  for (const role of ['derek', 'suki', 'amigo']) for (const width of [390, 1280]) {
    scenario = role;
    const context = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/control**', route => route.fulfill({ json: { currentUser: { id: ids[role], email: `${role}@example.test`, displayName: role }, profile: { user_id: ids[role], active: true, workspace_role: role }, settings: {}, operatingItems: [], tasks: [], transactions: [], planning: [], assignments: [], shares: [], participants: [], taskFollowers: [], taskNoticeRecipients: [], currentUserId: ids[role], quietModeUntil: null } }));
    await page.goto(`${base}/workspace/note`);
    const google = page.getByRole('button', { name: '使用 Google 登入', exact: true });
    await google.waitFor();
    assert.notEqual(await google.evaluate(button => getComputedStyle(button).backgroundColor), 'rgba(0, 0, 0, 0)');
    if (role === 'derek' && width === 390 && process.env.LOGIN_SCREENSHOT) await page.screenshot({ path: process.env.LOGIN_SCREENSHOT, fullPage: true });
    assert.equal(await page.getByLabel('電郵地址', { exact: true }).isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (role === 'derek' && width === 390) {
      await page.getByText('其他登入方法（後備）', { exact: true }).click();
      assert.equal(await page.getByLabel('電郵地址', { exact: true }).isVisible(), true);
      await page.getByText('其他登入方法（後備）', { exact: true }).click();
    }
    await google.click();
    await page.getByRole('button', { name: '新增筆記', exact: true }).first().waitFor();
    assert.equal(new URL(page.url()).pathname, '/workspace/note');
    assert.equal(new URL(page.url()).search, '');
    const cookies = await context.cookies();
    assert.ok(cookies.find(cookie => cookie.name === 'dcp_access' && cookie.httpOnly));
    assert.ok(cookies.find(cookie => cookie.name === 'dcp_refresh' && cookie.httpOnly));
    assert.equal(cookies.some(cookie => cookie.name === 'dcp_google_flow'), false);
    const identity = await context.request.get(`${base}/api/auth`);
    assert.equal((await identity.json()).user.id, ids[role]);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => /auth|token/i.test(key))), false);
    await page.reload(); await page.getByRole('button', { name: '新增筆記', exact: true }).first().waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS simulated Google → existing ${role} identity → app → reload (${width}px)`);
    await context.close();
  }
  for (const failure of ['cancelled', 'inactive', 'missing-profile', 'wrong-provider']) {
    scenario = failure;
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(`${base}/workspace/note`);
    await page.getByRole('button', { name: '使用 Google 登入', exact: true }).click();
    const message = page.getByRole('alert').filter({ hasText: failure === 'cancelled' ? '已取消' : '未連結' });
    await message.waitFor();
    assert.match(await message.innerText(), failure === 'cancelled' ? /已取消/ : /未連結/);
    assert.equal((await context.cookies()).some(cookie => cookie.name === 'dcp_access'), false);
    console.log(`PASS ${failure}: no app session issued`);
    await context.close();
  }
  console.log('LOCAL MOCK INTEGRATION PASS — real Google provider and three-user live sign-in still require acceptance testing.');
} catch (error) {
  console.error(logs.slice(-2500));
  throw error;
} finally {
  await browser?.close();
  server.kill();
  backend.closeAllConnections();
  await new Promise(resolve => backend.close(resolve));
}
