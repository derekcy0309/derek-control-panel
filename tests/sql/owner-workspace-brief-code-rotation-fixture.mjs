import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

// Runs against the prior migrations in the existing local PostgreSQL harness.
// All grants, users, sessions and hashes are synthetic.
export async function testOwnerWorkspaceBriefRotation({ db, asRole, owner, other, task, hidden, foreign, tag, directory }) {
  const row = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const value = async (sql, params = []) => (await row(sql, params))?.v;
  const root = () => db.exec("reset role");
  const service = () => asRole("service_role");
  const name = (await readdir(directory)).find(file => file.endsWith("_owner_workspace_brief_code_rotation.sql"));
  assert.ok(name, "CLI-created rotation migration exists");
  const legacy = await readFile(new URL("20261122032557_grok_personal_approved_archive.sql", directory), "utf8");
  const helper = fn => {
    const definition = legacy.match(new RegExp(`create function grok_personal_internal\\.${fn}\\([^]*?\\$\\$;`))?.[0];
    assert.ok(definition, `Production helper ${fn} is available`);
    return definition;
  };
  const key = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const act = (hash, action = "status", payload = {}) =>
    value("select public.agent_access_operation($1,$2,$3::jsonb) v", [hash, action, JSON.stringify(payload)]);
  const brief = hash => value("select public.agent_brief_owner($1) v", [hash]);
  const school = hash => value("select public.school_bot_request($1,'brief','{}') v", [hash]);
  const activeCount = () => value("select count(*)::int v from public.agent_access_grants where owner_id=$1 and revoked_at is null and expires_at>clock_timestamp()", [owner]);
  const relevantState = () => db.query(`select id,owner_id,label,created_at,expires_at,revoked_at,
    last_used_at,create_tag_ids,owner_workspace,token_hash from public.agent_access_grants order by id`).then(r => r.rows);
  const linkState = () => Promise.all(["agent_access_resources", "agent_brief_permissions", "agent_school_scopes"].map(table =>
    db.query(`select to_jsonb(x) v from public.${table} x order by to_jsonb(x)::text`).then(r => r.rows)));
  const targetLabel = "Grok Bot（本人工作）";
  const me = crypto.randomUUID(), wrongSession = crypto.randomUUID(), expiredSession = crypto.randomUUID();
  const make = (hash, label) => value("select public.create_my_agent_access($1,$2,30,$3::uuid[],'{}',$4::uuid[]) v", [hash, label, [task], [tag]]);
  const human = async (user = owner, session = me) => {
    await asRole("authenticated", user);
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({
      sub: user, role: "authenticated", session_id: session,
      amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) }]
    })]);
  };

  await root();
  await db.exec("alter table auth.users add column email text, add column email_confirmed_at timestamptz;");
  await db.query("update auth.users set email=case when id=$1 then 'derekcy0309@gmail.com' else 'other@example.test' end,email_confirmed_at=now() where id in ($1,$2)", [owner, other]);
  // The other account is also an admin, but not the explicitly approved Derek.
  await db.query("update public.user_profiles set is_admin=true where user_id=$1", [other]);
  await db.query("insert into auth.sessions values($1,$3,null),($2,$4,null),($5,$3,now()-interval '1 minute')", [me, wrongSession, owner, other, expiredSession]);
  await db.exec(`${helper("allowed_owner")} ${helper("active_session")}
    revoke all on function grok_personal_internal.allowed_owner(uuid),grok_personal_internal.active_session(uuid,uuid) from public,anon,authenticated,service_role;
    grant execute on function grok_personal_internal.allowed_owner(uuid),grok_personal_internal.active_session(uuid,uuid) to service_role;`);
  const legacyHash = key(), replacement = key(), alternateHash = key();
  await human();
  const target = await make(legacyHash, targetLabel);
  await value("select public.enable_my_agent_brief($1) v", [target.id]);
  await value("select public.school_owner_decision('scope',$1,'redact') v", [target.id]);
  const alternate = await make(alternateHash, "Another authorized code");
  while (await activeCount() < 5) await make(key(), "Full-cap fixture");
  assert.equal(await activeCount(), 5);
  await assert.rejects(make(key(), "Over cap fixture"), /AGENT_INVALID/);
  await service();
  assert.equal((await act(legacyHash)).scope, undefined);
  assert.equal(await brief(legacyHash), owner);
  assert.equal((await school(legacyHash)).enabled, true);

  await root();
  const beforeMigration = await relevantState();
  const beforeLinks = await linkState();
  await db.exec(await readFile(new URL(name, directory), "utf8"));
  assert.deepEqual(await relevantState(), beforeMigration, "Installing capability never changes existing grants");
  assert.deepEqual(await linkState(), beforeLinks, "Installing capability never changes existing authorizations");
  const beforeTarget = await row("select expires_at::text as expires,created_at::text as created_at from public.agent_access_grants where id=$1", [target.id]);
  const alternateExpiry = await value("select expires_at::text v from public.agent_access_grants where id=$1", [alternate.id]);
  const rotate = (params = {}) => value("select public.rotate_owner_workspace_brief_code($1,$2,$3,$4,$5) v", [
    params.owner ?? owner, params.grant ?? target.id, params.expires ?? beforeTarget.expires,
    params.hash ?? replacement, params.session ?? me
  ]);

  // The wrapper and issuer take the same advisory lock in PostgreSQL before
  // dispatch. The wrapper must re-read the supplied hash after waiting, because
  // the older handler inside it only rechecks the grant ID.
  const definition = await value("select pg_get_functiondef('public.agent_access_operation(text,text,jsonb)'::regprocedure) v");
  const originalLookup = definition.indexOf("where g.token_hash=p_token_hash");
  const advisoryLock = definition.indexOf("pg_advisory_xact_lock(hashtextextended(grant_id_value::text,0))");
  const exactRecheck = definition.indexOf("where g.id=grant_id_value and g.token_hash=p_token_hash");
  const oldDispatch = definition.indexOf("school_bot_internal.agent_base_operation_before_school(");
  assert.ok(originalLookup >= 0 && originalLookup < advisoryLock && advisoryLock < exactRecheck && exactRecheck < oldDispatch);
  const issuer = await value("select pg_get_functiondef('public.rotate_owner_workspace_brief_code(uuid,uuid,timestamptz,text,uuid)'::regprocedure) v");
  assert.ok(issuer.indexOf("pg_advisory_xact_lock(hashtextextended(p_grant_id::text,0))") < issuer.indexOf("for update of a"));

  await asRole("anon");
  await assert.rejects(rotate(), /permission denied/);
  await human();
  await assert.rejects(rotate(), /permission denied/);
  await service();
  await assert.rejects(rotate({ owner: other, session: wrongSession }), /AGENT_FORBIDDEN/);
  await assert.rejects(rotate({ session: wrongSession }), /AGENT_REAUTH/);
  await assert.rejects(rotate({ session: expiredSession }), /AGENT_REAUTH/);
  await assert.rejects(rotate({ session: crypto.randomUUID() }), /AGENT_REAUTH/);
  await assert.rejects(rotate({ hash: "not-a-hash" }), /AGENT_INVALID/);
  await assert.rejects(rotate({ hash: legacyHash }), /AGENT_ROTATE_CONFLICT/);
  await assert.rejects(rotate({ hash: alternateHash }), /AGENT_ROTATE_CONFLICT/);
  await assert.rejects(rotate({ grant: alternate.id, expires: alternateExpiry }), /AGENT_ROTATE_CONFLICT/);
  await assert.rejects(rotate({ expires: "2030-01-01T00:00:00Z" }), /AGENT_ROTATE_CONFLICT/);

  await root();
  const duplicate = await value(`insert into public.agent_access_grants(owner_id,label,token_hash,create_tag_ids,expires_at)
    values($1,$2,$3,$4::uuid[],now()+interval '7 days') returning id v`, [owner, targetLabel, key(), [tag]]);
  await db.query("insert into public.agent_brief_permissions(grant_id,owner_id) values($1,$2)", [duplicate, owner]);
  await service();
  await assert.rejects(rotate(), /AGENT_ROTATE_CONFLICT/, "If two active grants match the exact target, do nothing");
  await root();
  await db.query("update public.agent_access_grants set revoked_at=now() where id=$1", [duplicate]);
  const changesBefore = (await relevantState()).filter(g => g.id !== target.id);
  const linksBefore = await linkState();
  await service();
  const rotated = await rotate();
  assert.deepEqual(Object.keys(rotated).sort(), ["code_rotated_at","expires_at","id","label","owner_workspace"]);
  assert.equal(rotated.id, target.id);
  assert.equal(rotated.owner_workspace, true);
  assert.equal(await activeCount(), 5, "In-place rotation remains within the active-code cap");
  await assert.rejects(rotate(), /AGENT_ROTATE_CONFLICT/, "A stale tab cannot rotate again");
  await assert.rejects(act(legacyHash), /AGENT_UNAUTHORIZED/);
  await assert.rejects(brief(legacyHash), /AGENT_UNAUTHORIZED/);
  await assert.rejects(school(legacyHash), /SCHOOL_AUTH/);
  assert.equal((await act(replacement)).scope, "owner_workspace");
  assert.equal((await act(replacement, "detail", { kind: "task", id: hidden })).item.id, hidden);
  await assert.rejects(act(replacement,"detail",{kind:"task",id:foreign}),/AGENT_NOT_FOUND/);
  await assert.rejects(act(replacement,"settings",{}),/AGENT_FORBIDDEN/);
  await assert.rejects(act(replacement,"delete",{kind:"task",id:task}),/AGENT_FORBIDDEN/);
  assert.equal(await brief(replacement), owner);
  assert.equal((await school(replacement)).enabled, true);
  assert.deepEqual(await linkState(), linksBefore);
  assert.deepEqual((await relevantState()).filter(g => g.id !== target.id), changesBefore);
  assert.equal(await value("select created_at=$2 and expires_at=code_rotated_at+interval '365 days' v from public.agent_access_grants where id=$1", [target.id, beforeTarget.created_at]), true);
  assert.equal(await value("select count(*)::int v from public.agent_access_events where grant_id=$1 and action='code_rotated'", [target.id]), 1);
  assert.equal(await value("select amount v from public.transactions where id=1"), "1234");

  await root();
  await db.exec(await readFile(new URL("../../supabase/rollback-owner-workspace-brief-code-rotation.sql", import.meta.url), "utf8"));
  await service();
  await assert.rejects(rotate({ expires: rotated.expires_at }), /permission denied/);
  assert.equal(await brief(replacement), owner, "Rollback disables issuing but keeps the valid replacement and brief");
  await assert.rejects(brief(legacyHash), /AGENT_UNAUTHORIZED/);
  await root();
  console.log("PASS exact Derek Agent code rotation: cap, same ID, 365 days, active human session, stale-key rejection, legacy scopes and safe rollback");
}
