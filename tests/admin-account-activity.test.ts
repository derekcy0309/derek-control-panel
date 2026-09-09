import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path: string) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("account activity migration is additive, throttled, and self-scoped", async () => {
  const [migration, rollback] = await Promise.all([
    source("../supabase/migrations/20260803100000_admin_account_activity.sql"),
    source("../supabase/migrations/20260803100000_admin_account_activity.rollback.sql")
  ]);
  const sql = migration.toLowerCase();
  const undo = rollback.toLowerCase();

  assert.match(sql, /add column if not exists last_seen_at timestamptz/);
  assert.match(sql, /create index if not exists user_profiles_last_seen_at_idx/);
  assert.match(sql, /function public\.touch_current_user_last_seen/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /actor uuid := \(select auth\.uid\(\)\)/);
  assert.match(sql, /where user_id = actor/);
  assert.match(sql, /last_seen_at < now\(\) - interval '5 minutes'/);
  assert.match(sql, /revoke all on function public\.touch_current_user_last_seen\(\) from public, anon/);
  assert.match(sql, /grant execute on function public\.touch_current_user_last_seen\(\) to authenticated/);
  assert.match(undo, /drop function if exists public\.touch_current_user_last_seen/);
  assert.match(undo, /drop index if exists public\.user_profiles_last_seen_at_idx/);
  assert.doesNotMatch(undo, /drop column/);
});

test("account list is server-only and requires an active administrator", async () => {
  const route = await source("../app/api/admin/users/route.ts");

  assert.match(route, /authenticateRequest\(request\)/);
  assert.match(route, /select\("is_admin,active"\)/);
  assert.match(route, /!administrator\.data\?\.is_admin \|\| !administrator\.data\.active/);
  assert.match(route, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(route, /admin\.auth\.admin\.listUsers/);
  assert.match(route, /last_sign_in_at/);
  assert.match(route, /last_seen_at/);
  assert.match(route, /maxPages = 10/);
  assert.match(route, /perPage: pageSize/);
  assert.match(route, /showEncouragement: encouragementVisibleFor\(user\)/);
  assert.match(route, /user\.app_metadata\?\.show_encouragement/);
  assert.match(route, /derekcy0309@gmail\.com/);
});

test("administrators can manage encouragement visibility and delete a confirmed non-current account", async () => {
  const [route, panel, controlApi, shell, controlRoute] = await Promise.all([
    source("../app/api/admin/users/route.ts"),
    source("../components/AdminAccountActivityPanel.tsx"),
    source("../lib/control-api.ts"),
    source("../components/AppShell.tsx"),
    source("../app/api/control/route.ts")
  ]);

  assert.match(route, /action === "set_encouragement_visibility"/);
  assert.match(route, /admin\.auth\.admin\.updateUserById/);
  assert.match(route, /app_metadata: \{ \.\.\.\(target\.app_metadata \?\? \{\}\), show_encouragement: body\.visible \}/);
  assert.match(route, /action === "delete_account"/);
  assert.match(route, /requestOrigin && requestOrigin !== request\.nextUrl\.origin/);
  assert.match(route, /targetUserId === context\.user\.id/);
  assert.match(route, /body\.confirmEmail\?\.trim\(\)\.toLowerCase\(\) !== targetEmail/);
  assert.match(route, /不可刪除最後一個啟用中的管理員帳戶/);
  assert.match(route, /admin\.auth\.admin\.deleteUser\(targetUserId\)/);
  assert.match(panel, /每頁鼓勵句/);
  assert.match(panel, /輸入完整電郵確認/);
  assert.match(panel, /永久刪除帳戶/);
  assert.match(controlApi, /set_encouragement_visibility/);
  assert.match(controlApi, /delete_account/);
  assert.match(shell, /showEncouragement \? <EncouragementFooter/);
  assert.match(controlRoute, /showEncouragement: encouragementVisibleFor\(user\)/);
});

test("admin activity page, protected navigation, and use tracking are wired", async () => {
  const [panel, page, shell, requestContext, controlRoute, controlApi] = await Promise.all([
    source("../components/AdminAccountActivityPanel.tsx"),
    source("../app/admin/accounts/page.tsx"),
    source("../components/AppShell.tsx"),
    source("../lib/server/request-context.ts"),
    source("../app/api/control/route.ts"),
    source("../lib/control-api.ts")
  ]);

  assert.match(panel, /上次登入/);
  assert.match(panel, /上次使用/);
  assert.match(panel, /新版尚未記錄/);
  assert.match(panel, /loadAdminAccountUsers/);
  assert.match(page, /data\.profile\.is_admin/);
  assert.match(page, /data\.profile\.active/);
  assert.match(shell, /systemGroup/);
  assert.match(shell, /isAdmin/);
  assert.match(shell, /isAdmin \? \[\.\.\.systemItems/);
  assert.match(shell, /帳戶活動/);
  assert.match(requestContext, /touch_current_user_last_seen/);
  assert.match(controlRoute, /touch_current_user_last_seen/);
  assert.match(controlApi, /\/api\/admin\/users/);
});
