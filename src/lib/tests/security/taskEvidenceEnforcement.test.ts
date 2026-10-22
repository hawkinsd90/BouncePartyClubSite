// Required delivery / pickup photo evidence (NI-11 / WP-32, migration M-5).
//
//   STATIC     checks the migration text (always runs).
//   EXECUTED   applies the real migration file to a THROWAWAY database on the local scratch PostgreSQL (never a Supabase project) that
//              holds the few tables the migration touches, then plays crew, Admin, backend and anonymous callers against the
//              trigger and the two functions. Locate PostgreSQL with CORE_DB_HOST (127.0.0.1), CORE_DB_PORT (54329), CORE_DB_PSQL.
//              When it is not reachable the EXECUTED layer is reported SKIPPED (an environment limitation, not a pass);
//              CORE_DB_REQUIRE=1 makes that a failure.
// PASS - LOCAL INTEGRATION. Crew completing a real task with and without a photo on hosted Dev is REQUIRES HOSTED DEV VERIFICATION.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined>; pid: number; exit(code: number): never };
const fs = require('fs');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;
let skipped = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
const read = (p: string): string => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = 'supabase/migrations/20261027160000_task_evidence_required.sql';
const sql = read(MIGRATION);

// ---- static -------------------------------------------------------------------------------------------------------------
ok('static: the trigger fires only for browser roles', /v_role NOT IN \('authenticated', 'anon'\)/.test(sql));
ok('static: only the move into completed is checked, and already completed rows are left alone', /OLD\.status IS NOT DISTINCT FROM 'completed'/.test(sql));
ok('static: the setting defaults to required (only an explicit false relaxes it)', /NOT COALESCE\(/.test(sql) && /= 'false'/.test(sql));
ok('static: overrides are created only by the Admin-only function', /IF NOT public\.is_admin\(\)/.test(sql) && /char_length\(btrim\(p_reason\)\) < 10/.test(sql) && /REVOKE ALL ON TABLE public\.task_evidence_overrides FROM PUBLIC, anon, authenticated;/.test(sql) && !/GRANT (INSERT|UPDATE|DELETE)[^;]*TO authenticated/.test(sql));
ok('static: crew can read the state but not create overrides (state uses is_crew_or_admin, override uses is_admin)', /get_task_evidence_state[\s\S]*?is_crew_or_admin\(\)/.test(sql));
ok('static: browser roles cannot call the trigger or the helpers; anon cannot call the RPCs', /REVOKE ALL ON FUNCTION public\.enforce_task_evidence\(\) FROM PUBLIC, anon, authenticated;/.test(sql) && /REVOKE ALL ON FUNCTION public\.override_task_evidence\(uuid, text\) FROM PUBLIC, anon;/.test(sql));
ok('static: no data is rewritten (additive migration)', !/UPDATE public\.|DELETE FROM public\./.test(sql.replace(/\/\*[\s\S]*?\*\//, '')));

// ---- executed -----------------------------------------------------------------------------------------------------------
const HOST = process.env.CORE_DB_HOST ?? '127.0.0.1';
const PORT = process.env.CORE_DB_PORT ?? '54329';
const PSQL = process.env.CORE_DB_PSQL ?? 'psql';
const psql = (db: string, args: string[], input?: string) =>
  spawnSync(PSQL, ['-h', HOST, '-p', PORT, '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args], { encoding: 'utf8', input, env: { ...process.env, PGCLIENTENCODING: 'UTF8' } });

const probe = psql('postgres', ['-c', 'select 1']);
if (probe.status !== 0 || probe.stdout.trim() !== '1') {
  if (process.env.CORE_DB_REQUIRE === '1') {
    console.error('FAIL: scratch PostgreSQL is required (CORE_DB_REQUIRE=1) but is not reachable');
    process.exit(1);
  }
  skipped++;
  console.log('SKIPPED (environment): scratch PostgreSQL is not reachable, so the executed layer did not run.');
} else {
  const db = `bpc_m5_${process.pid}`;
  const CREW = '00000000-0000-4000-8000-0000000000c1';
  const ADMIN = '00000000-0000-4000-8000-0000000000a1';
  const OUTSIDER = '00000000-0000-4000-8000-0000000000e1';
  const ORDER = '11111111-1111-4111-8111-111111111111';
  const T = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
  const as = (role: string, uid: string | null, statement: string) =>
    psql(db, ['-c', `${uid ? `select set_config('request.jwt.claim.sub','${uid}',false);` : ''} set role ${role}; ${statement}`]);
  const sup = (statement: string) => psql(db, ['-c', statement]);
  const q = (statement: string) => sup(statement).stdout.trim();
  const statusOf = (id: string) => q(`select status from public.task_status where id='${id}'`);
  const mkTask = (n: number, type: string, images = '[]', status = 'pending') =>
    sup(`insert into public.task_status(id, order_id, task_type, task_date, status, delivery_images) values ('${T(n)}','${ORDER}','${type}', date '2026-11-10' + ${n}, '${status}', '${images}'::jsonb)`);
  const complete = (role: string, uid: string | null, n: number) => as(role, uid, `update public.task_status set status='completed', completed_time=now() where id='${T(n)}'`);
  const blocked = (r: any) => r.status !== 0 && /EVIDENCE_REQUIRED/.test(r.stderr);

  try {
    psql('postgres', ['-c', `drop database if exists ${db}`]);
    const created = psql('postgres', ['-c', `create database ${db}`]);
    if (created.status !== 0) throw new Error('cannot create throwaway database: ' + created.stderr);
    const setup = psql(db, [], `
      do $$ begin
        if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
      end $$;
      create schema if not exists auth;
      create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
      grant usage on schema auth, public to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      create table public.user_roles(user_id uuid, role text);
      create table public.admin_settings(key text primary key, value text);
      create table public.task_status(
        id uuid primary key default gen_random_uuid(), order_id uuid not null, task_type text not null check (task_type in ('drop-off','pick-up')),
        task_date date not null, status text not null default 'pending' check (status in ('pending','en_route','arrived','completed')),
        completed_time timestamptz, delivery_images jsonb default '[]'::jsonb, damage_images jsonb default '[]'::jsonb,
        unique (order_id, task_type, task_date));
      grant select, insert, update on public.task_status to authenticated;
      grant select on public.task_status to anon;
      grant all on public.task_status, public.admin_settings, public.user_roles to service_role;
      create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $f$
        select exists (select 1 from public.user_roles where user_id = auth.uid() and lower(role) in ('admin','master')) $f$;
      create or replace function public.is_crew_or_admin() returns boolean language sql stable security definer set search_path = public as $f$
        select exists (select 1 from public.user_roles where user_id = auth.uid() and lower(role) in ('admin','master','crew')) $f$;
      insert into public.user_roles values ('${CREW}','crew'), ('${ADMIN}','admin');`);
    if (setup.status !== 0) throw new Error('scratch setup failed: ' + setup.stderr);

    // the real migration, strictly, twice (idempotent)
    ok('executed: the migration applies strictly', psql(db, ['-1'], sql).status === 0);
    ok('executed: ... and a second time (idempotent)', psql(db, ['-1'], sql).status === 0);

    // 1. a delivery with no photo
    mkTask(1, 'drop-off');
    const r1 = complete('authenticated', CREW, 1);
    ok('crew: completing a delivery without a photo is refused with EVIDENCE_REQUIRED', blocked(r1));
    ok('crew: ... and the task stays pending', statusOf(T(1)) === 'pending');
    ok('crew: a status change that is not "completed" (en route) is not blocked', as('authenticated', CREW, `update public.task_status set status='en_route' where id='${T(1)}'`).status === 0);
    // 2. with a photo
    mkTask(2, 'drop-off', '["o/t/delivery/a.jpg"]');
    ok('crew: completing a delivery that has one photo works', complete('authenticated', CREW, 2).status === 0 && statusOf(T(2)) === 'completed');
    mkTask(3, 'drop-off', '{}');
    ok('crew: a malformed images value counts as no photo', blocked(complete('authenticated', CREW, 3)));
    mkTask(4, 'drop-off', 'null');
    ok('crew: a JSON null counts as no photo', blocked(complete('authenticated', CREW, 4)));
    // 3. pickup and the settings
    mkTask(5, 'pick-up');
    ok('crew: completing a pickup without a photo is refused', blocked(complete('authenticated', CREW, 5)));
    sup("insert into public.admin_settings values ('require_pickup_photo','false')");
    ok('setting off for pickups: the same completion now works', complete('authenticated', CREW, 5).status === 0 && statusOf(T(5)) === 'completed');
    mkTask(6, 'drop-off');
    ok('setting off for pickups does not relax deliveries', blocked(complete('authenticated', CREW, 6)));
    sup("update public.admin_settings set value='banana' where key='require_pickup_photo'");
    mkTask(7, 'pick-up');
    ok('a garbled setting means required', blocked(complete('authenticated', CREW, 7)));
    sup("update public.admin_settings set value=' FALSE ' where key='require_pickup_photo'");
    ok('"FALSE" with spaces counts as off', complete('authenticated', CREW, 7).status === 0);
    sup("delete from public.admin_settings where key='require_pickup_photo'");
    mkTask(8, 'pick-up');
    ok('a missing setting means required', blocked(complete('authenticated', CREW, 8)));
    sup("insert into public.admin_settings values ('require_delivery_photo','false')");
    ok('delivery setting off: a delivery completes without a photo', complete('authenticated', CREW, 6).status === 0);
    sup("delete from public.admin_settings where key='require_delivery_photo'");

    // 4. state, override and who may do it
    mkTask(9, 'drop-off');
    const stateJson = (uid: string | null, n: number, role = 'authenticated') => {
      const r = as(role, uid, `select public.get_task_evidence_state('${T(n)}')`);
      return r.status === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : r;
    };
    const s0: any = stateJson(CREW, 9);
    ok('state (crew): photo required, none stored, not overridden, cannot complete', s0.required === true && s0.photo_count === 0 && s0.overridden === false && s0.can_complete === false);
    ok('state: an outsider with no staff role is refused', stateJson(OUTSIDER, 9).status !== 0);
    ok('state: anon cannot call it', as('anon', null, `select public.get_task_evidence_state('${T(9)}')`).status !== 0);
    ok('state: an unknown task answers null', as('authenticated', CREW, `select coalesce(public.get_task_evidence_state('${T(999)}')::text,'null')`).stdout.trim().endsWith('null'));
    const crewOverride = as('authenticated', CREW, `select public.override_task_evidence('${T(9)}', 'Customer asked us not to photograph the yard')`);
    ok('crew cannot override (42501)', crewOverride.status !== 0 && /forbidden/.test(crewOverride.stderr));
    ok('anon cannot override', as('anon', null, `select public.override_task_evidence('${T(9)}', 'Customer asked us not to photograph')`).status !== 0);
    const shortReason = as('authenticated', ADMIN, `select public.override_task_evidence('${T(9)}', 'too short')`);
    ok('admin: a reason under 10 characters is refused', shortReason.status !== 0 && /at least 10/.test(shortReason.stderr));
    ok('no override exists yet, so crew is still blocked', blocked(complete('authenticated', CREW, 9)));
    const adminOverride = as('authenticated', ADMIN, `select public.override_task_evidence('${T(9)}', 'Customer asked us not to photograph the yard')`);
    ok('admin: a proper override is recorded', adminOverride.status === 0);
    ok('the record holds the task, the admin and the reason', q(`select task_type || '|' || actor_id || '|' || reason from public.task_evidence_overrides where task_status_id='${T(9)}'`) === `drop-off|${ADMIN}|Customer asked us not to photograph the yard`);
    ok('a second override of the same task adds no second row', as('authenticated', ADMIN, `select public.override_task_evidence('${T(9)}', 'Another long enough reason here')`).status === 0 && q(`select count(*) from public.task_evidence_overrides where task_status_id='${T(9)}'`) === '1');
    const s1: any = stateJson(CREW, 9);
    ok('state after the override: overridden and can complete', s1.overridden === true && s1.can_complete === true);
    ok('crew can now complete the overridden task', complete('authenticated', CREW, 9).status === 0 && statusOf(T(9)) === 'completed');
    ok('the override covers that task only', (() => { mkTask(10, 'drop-off'); return blocked(complete('authenticated', CREW, 10)); })());
    ok('override of an unknown task is refused', as('authenticated', ADMIN, `select public.override_task_evidence('${T(998)}', 'Reason that is long enough')`).status !== 0);

    // 5. the table itself
    ok('crew cannot read the overrides table (RLS: admin only)', as('authenticated', CREW, 'select count(*) from public.task_evidence_overrides').stdout.trim().endsWith('0'));
    ok('admin can read the overrides table', as('authenticated', ADMIN, 'select count(*) from public.task_evidence_overrides').stdout.trim().endsWith('1'));
    for (const stmt of [`insert into public.task_evidence_overrides(task_status_id, order_id, task_type, actor_id, reason) values ('${T(10)}','${ORDER}','drop-off','${CREW}','forged override by crew')`, `update public.task_evidence_overrides set reason='edited by someone'`, 'delete from public.task_evidence_overrides']) {
      for (const [role, uid] of [['authenticated', CREW], ['authenticated', ADMIN], ['anon', null]] as Array<[string, string | null]>) {
        const r = as(role, uid, stmt);
        ok(`no direct write to the overrides table as ${role}${uid === ADMIN ? ' (admin)' : ''}: ${stmt.slice(0, 22)}`, r.status !== 0 && /permission denied/.test(r.stderr));
      }
    }
    ok('anon cannot read the overrides table', as('anon', null, 'select count(*) from public.task_evidence_overrides').status !== 0);

    // 6. who is not subject to the rule, and what is left alone
    mkTask(11, 'drop-off');
    ok('the backend (service_role) can complete without a photo', complete('service_role', null, 11).status === 0 && statusOf(T(11)) === 'completed');
    mkTask(12, 'drop-off');
    ok('a maintenance session (the connecting superuser) is not blocked', sup(`update public.task_status set status='completed' where id='${T(12)}'`).status === 0);
    ok('an already completed task can still be edited by crew (it is not re-checked)', as('authenticated', CREW, `update public.task_status set completed_time = now() where id='${T(11)}'`).status === 0);
    ok('...but taking it out of completed and back in is checked again', (() => {
      sup(`update public.task_status set status='pending' where id='${T(11)}'`);
      return blocked(complete('authenticated', CREW, 11));
    })());
    ok('creating a task row that is already completed is checked too', blocked(as('authenticated', CREW, `insert into public.task_status(order_id, task_type, task_date, status) values ('${ORDER}','drop-off','2027-01-01','completed')`)));
    ok('creating a normal pending task row is fine for crew', as('authenticated', CREW, `insert into public.task_status(order_id, task_type, task_date) values ('${ORDER}','drop-off','2027-01-02')`).status === 0);

    // 7. function privileges
    for (const fn of ['public.enforce_task_evidence()', 'public.task_evidence_required(text)', 'public.task_evidence_photo_count(jsonb)']) {
      ok(`${fn}: not executable by anon or authenticated`, q(`select has_function_privilege('anon','${fn}','execute') or has_function_privilege('authenticated','${fn}','execute')`) === 'f');
    }
    ok('override_task_evidence / get_task_evidence_state: authenticated and service_role only', q("select has_function_privilege('authenticated','public.override_task_evidence(uuid,text)','execute') and has_function_privilege('service_role','public.get_task_evidence_state(uuid)','execute') and not has_function_privilege('anon','public.override_task_evidence(uuid,text)','execute') and not has_function_privilege('anon','public.get_task_evidence_state(uuid)','execute')") === 't');
  } catch (e: any) {
    failed++;
    console.error('FAIL: executed layer error:', e?.message ?? e);
  } finally {
    psql('postgres', ['-c', `drop database if exists ${db}`]);
  }
}

console.log(`taskEvidenceEnforcement: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) throw new Error(`${failed} task evidence test(s) failed`);
