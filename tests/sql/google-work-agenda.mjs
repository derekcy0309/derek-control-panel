import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

if (!process.env.PGLITE_MODULE) throw new Error("Set PGLITE_MODULE to local PGlite");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const dir = new URL("../../supabase/migrations/", import.meta.url);
const base = await readFile(new URL("20260726120000_life_os_ai_calendar_email.sql", dir), "utf8");
const migrationName = (await readdir(dir)).find(name => /_google_work_calendar_agenda\.sql$/.test(name));
assert.ok(migrationName);
const migration = await readFile(new URL(migrationName, dir), "utf8");
const rollback = await readFile(new URL(migrationName.replace(/\.sql$/, ".rollback.sql"), dir), "utf8");
const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const data = async q => (await db.query(q)).rows;
async function human(user) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await db.exec("set role authenticated");
}

try {
  await db.exec(`
    create role authenticated;
    create role anon;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    insert into auth.users values ('${first}'), ('${second}');
  `);
  const existing = base.match(/create table if not exists public\.google_calendar_connections \([\s\S]*?\n\);/)?.[0];
  const ownPolicy = base.match(/create policy google_calendar_connections_own[\s\S]*?with check \(user_id = \(select auth\.uid\(\)\)\);/)?.[0];
  assert.ok(existing && ownPolicy, "Validate against the real existing schema and RLS policy.");
  await db.exec(existing);
  await db.exec("alter table public.google_calendar_connections enable row level security;" + ownPolicy);
  await db.exec("grant select, insert, update, delete on public.google_calendar_connections to authenticated;");
  await db.exec(`insert into public.google_calendar_connections(user_id,target,account_email)
    values ('${first}','work','work@one.test'), ('${first}','personal','person@one.test'), ('${second}','work','work@two.test');`);
  await db.exec(migration);
  const table = "public.google_calendar_connections";
  assert.deepEqual(await data(`select count(*)::int n from ${table} where show_work_in_agenda`), [{ n: 0 }]);
  await human(first);
  assert.deepEqual(await data(`update ${table} set show_work_in_agenda=true where user_id='${second}' returning id`), []);
  await assert.rejects(db.exec(`update ${table} set show_work_in_agenda=true where target='personal'`), /google_calendar_agenda_work_only/);
  assert.deepEqual(await data(`update ${table} set show_work_in_agenda=true where target='work' returning show_work_in_agenda`), [{ show_work_in_agenda: true }]);
  await human(second);
  assert.deepEqual(await data(`select show_work_in_agenda from ${table} where target='work'`), [{ show_work_in_agenda: false }]);
  await human(first);
  for (const selectionChange of ["calendar_id='new-selection'", "account_email='new@one.test'", "status='disconnected'"]) {
    await db.exec(`update ${table} set show_work_in_agenda=true where target='work'`);
    assert.deepEqual(await data(`update ${table} set ${selectionChange} where target='work' returning show_work_in_agenda`), [{ show_work_in_agenda: false }]);
  }
  await db.exec("reset role; set role anon");
  await assert.rejects(db.exec(`select show_work_in_agenda from ${table}`), /permission denied/);
  await db.exec("reset role");
  await db.exec(rollback);
  assert.deepEqual(await data(`select count(*)::int n from ${table}`), [{ n: 3 }]);
  await assert.rejects(db.exec(`select show_work_in_agenda from ${table}`), /does not exist/);
  console.log("Work Calendar migration: opt-out default, existing owner RLS, Work-only consent, source reset, rollback PASS");
} finally {
  await db.close();
}
