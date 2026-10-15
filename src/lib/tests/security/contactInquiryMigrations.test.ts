// contact_inquiries migration ordering.
//
// Three migrations touch public.contact_inquiries. Two of them (the service-role grant and the invoice-ready columns) are
// versioned BEFORE the one that creates the table, because the hosted Development database received them in that order. Their
// versions cannot change, so they must be safe on a database that has no table yet, and a later corrective migration must
// guarantee the same end state everywhere.
//
//   STATIC     checks the migration files and their order (always runs).
//   EXECUTED   applies the real files, strictly (ON_ERROR_STOP, one transaction per file), to THROWAWAY databases created and
//              dropped on a local scratch PostgreSQL: empty, Development-like, and old-base-table. It never touches a Supabase
//              project. Locate PostgreSQL with CORE_DB_HOST (127.0.0.1), CORE_DB_PORT (54329), CORE_DB_PSQL. When it is not
//              reachable the EXECUTED layer is reported SKIPPED (an environment limitation, not a pass); CORE_DB_REQUIRE=1 makes
//              that a failure. The scratch database only needs the anon / authenticated / service_role roles and a
//              user_roles table, which this test creates itself.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/security/contactInquiryMigrations.test.ts

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

const DIR = 'supabase/migrations/';
const GRANT = '20260814113146_grant_contact_inquiries_service_role.sql';
const UPGRADE = '20260814114825_upgrade_contact_inquiries_for_invoices.sql';
const CREATE = '20260814120000_create_contact_inquiries.sql';
const ENSURE = '20260814120100_ensure_contact_inquiries_invoice_fields.sql';
const INVOICE_COLUMNS = ['first_name', 'last_name', 'event_address', 'event_city', 'event_state', 'event_zip', 'event_start_time', 'event_end_time', 'surface_type', 'referral_source'];

// ---------------------------------------------------------------------------------------------------------------
// STATIC
// ---------------------------------------------------------------------------------------------------------------
const all: string[] = fs.readdirSync(DIR).filter((f: string) => f.endsWith('.sql')).sort();
const order = (f: string) => all.indexOf(f);
ok('static: all four contact-inquiry migrations exist', [GRANT, UPGRADE, CREATE, ENSURE].every((f) => order(f) >= 0));
ok('static: the historical versions are unchanged (grant < upgrade < create)', order(GRANT) < order(UPGRADE) && order(UPGRADE) < order(CREATE));
ok('static: the corrective migration runs after the table is created', order(ENSURE) > order(CREATE));
const touching = all.filter((f) => /contact_inquiries/.test(read(DIR + f)));
ok('static: only these four migrations mention contact_inquiries', JSON.stringify(touching.sort()) === JSON.stringify([GRANT, UPGRADE, CREATE, ENSURE].sort()));
for (const f of [GRANT, UPGRADE]) {
  const t = read(DIR + f).replace(/\/\*[\s\S]*?\*\//g, '');
  ok(`static: ${f} only acts when the table exists`, /IF to_regclass\('public\.contact_inquiries'\) IS NOT NULL THEN/.test(t));
  ok(`static: ${f} swallows no errors (no EXCEPTION handler)`, !/\bEXCEPTION\b/i.test(t));
  ok(`static: ${f} never drops or recreates the table`, !/DROP\s+TABLE|CREATE\s+TABLE/i.test(t));
}
const ensure = read(DIR + ENSURE).replace(/\/\*[\s\S]*?\*\//g, '');
ok('static: the corrective migration adds every invoice column idempotently', INVOICE_COLUMNS.every((c) => new RegExp(`ADD COLUMN IF NOT EXISTS ${c} text`).test(ensure)));
ok('static: the corrective migration grants only INSERT, SELECT, UPDATE to service_role', /GRANT INSERT, SELECT, UPDATE ON TABLE public\.contact_inquiries TO service_role;/.test(ensure) && !/[^a-z_](anon|authenticated)[^a-z_]|TO +PUBLIC/i.test(ensure));
ok('static: the corrective migration does not touch RLS or policies', !/ROW LEVEL SECURITY|POLICY/i.test(ensure));
const fn = read('supabase/functions/submit-contact-inquiry/index.ts');
const insertBlock = fn.slice(fn.indexOf(".from('contact_inquiries')"), fn.indexOf('.select(\'id\')'));
const written = [...insertBlock.matchAll(/^\s{8}(\w+):/gm)].map((m) => m[1]);
ok('static: submit-contact-inquiry writes the columns the migrations provide', written.length >= 16 && INVOICE_COLUMNS.every((c) => written.includes(c)));

// ---------------------------------------------------------------------------------------------------------------
// EXECUTED
// ---------------------------------------------------------------------------------------------------------------
const HOST = process.env.CORE_DB_HOST ?? '127.0.0.1';
const PORT = process.env.CORE_DB_PORT ?? '54329';
const PSQL = process.env.CORE_DB_PSQL ?? 'psql';
const psql = (db: string, args: string[], input?: string) =>
  spawnSync(PSQL, ['-h', HOST, '-p', PORT, '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args], { encoding: 'utf8', input, env: { ...process.env, PGCLIENTENCODING: 'UTF8' } });

const probe = psql('postgres', ['-c', 'select 1']);
if (probe.status !== 0) {
  if (process.env.CORE_DB_REQUIRE === '1') {
    failed++;
    console.error('FAIL: scratch PostgreSQL is required (CORE_DB_REQUIRE=1) but is not reachable');
  } else {
    skipped++;
    console.log('SKIPPED: EXECUTED layer — no scratch PostgreSQL reachable (environment limitation, not a pass)');
  }
} else {
  const dbs: string[] = [];
  const fresh = (name: string) => {
    const db = `ci_mig_${name}_${process.pid}`;
    dbs.push(db);
    psql('postgres', ['-c', `drop database if exists ${db} with (force)`, '-c', `create database ${db}`]);
    const r = psql(db, [], `
      do $$ begin
        if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
      end $$;
      create schema if not exists auth;
      create or replace function auth.uid() returns uuid language sql as 'select null::uuid';
      create table public.user_roles(user_id uuid, role text);`);
    if (r.status !== 0) throw new Error('scratch setup failed: ' + r.stderr);
    return db;
  };
  // Strict apply: a single transaction per file; any SQL error fails the file.
  const apply = (db: string, content: string) => psql(db, ['-1'], content);
  // The statements of the two early migrations exactly as they were first applied (before they were made conditional).
  const ORIG_GRANT = 'GRANT INSERT, SELECT, UPDATE ON TABLE public.contact_inquiries TO service_role;';
  const ORIG_UPGRADE = 'ALTER TABLE public.contact_inquiries ' + INVOICE_COLUMNS.map((c) => 'ADD COLUMN IF NOT EXISTS ' + c + ' text').join(', ') + '; ' + ORIG_GRANT;
  const state = (db: string) => {
    const q = (sql: string) => psql(db, ['-c', sql]).stdout.trim();
    return {
      cols: Number(q("select count(*) from information_schema.columns where table_schema='public' and table_name='contact_inquiries'")),
      invoiceCols: Number(q(`select count(*) from information_schema.columns where table_schema='public' and table_name='contact_inquiries' and column_name in (${INVOICE_COLUMNS.map((c) => `'${c}'`).join(',')})`)),
      service: q("select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') from information_schema.role_table_grants where table_name='contact_inquiries' and grantee='service_role'"),
      anonAny: q("select has_table_privilege('anon','public.contact_inquiries','SELECT') or has_table_privilege('anon','public.contact_inquiries','INSERT') or has_table_privilege('anon','public.contact_inquiries','UPDATE')"),
      authAny: q("select has_table_privilege('authenticated','public.contact_inquiries','SELECT') or has_table_privilege('authenticated','public.contact_inquiries','INSERT')"),
      rls: q("select relrowsecurity from pg_class where oid='public.contact_inquiries'::regclass"),
      policies: Number(q("select count(*) from pg_policies where tablename='contact_inquiries'")),
    };
  };
  const finalOk = (label: string, s: ReturnType<typeof state>) => {
    ok(`${label}: 19 columns including all 10 invoice columns`, s.cols === 19 && s.invoiceCols === 10);
    ok(`${label}: service_role has exactly INSERT, SELECT, UPDATE`, s.service === 'INSERT,SELECT,UPDATE');
    ok(`${label}: anon and authenticated have no table privileges`, s.anonAny === 'f' && s.authAny === 'f');
    ok(`${label}: RLS is enabled with the single admin SELECT policy`, s.rls === 't' && s.policies === 1);
  };

  try {
    // 0. Proof the defect existed: the committed originals, applied to an empty database, fail strictly.
    const db0 = fresh('orig');
    const r0 = apply(db0, ORIG_GRANT);
    ok('executed: the ORIGINAL grant migration fails on an empty database (the defect this change fixes)', r0.status !== 0 && /does not exist/.test(r0.stderr));

    // 1. Empty database, all four files in version order.
    const db1 = fresh('empty');
    for (const f of [GRANT, UPGRADE, CREATE, ENSURE]) {
      const r = apply(db1, read(DIR + f));
      ok(`executed/empty: ${f} applies strictly`, r.status === 0);
    }
    finalOk('executed/empty', state(db1));
    const ins = psql(db1, ['-c', "set role service_role; insert into public.contact_inquiries(name,first_name,last_name,email,phone,message,event_address,event_city,event_state,event_zip,event_start_time,event_end_time,surface_type,referral_source) values ('S','S','T','s@example.invalid','555','m','1 A St','C','MI','48201','10:00','14:00','grass','web'); update public.contact_inquiries set email_sent=true;"]);
    ok('executed/empty: service_role can insert every column submit-contact-inquiry writes and update email_sent', ins.status === 0);
    for (const role of ['anon', 'authenticated']) {
      const s = psql(db1, ['-c', `set role ${role}; select count(*) from public.contact_inquiries`]);
      const i = psql(db1, ['-c', `set role ${role}; insert into public.contact_inquiries(name,email,phone,message) values('a','b','c','d')`]);
      ok(`executed/empty: ${role} cannot read or write`, s.status !== 0 && /permission denied/.test(s.stderr) && i.status !== 0 && /permission denied/.test(i.stderr));
    }

    // 2. Development-like: the table already exists with the invoice columns and grant (original early files applied).
    const db2 = fresh('devlike');
    apply(db2, read(DIR + CREATE));
    ok('executed/dev-like: original grant file applies on an existing table', apply(db2, ORIG_GRANT).status === 0);
    ok('executed/dev-like: original upgrade file applies on an existing table', apply(db2, ORIG_UPGRADE).status === 0);
    psql(db2, ['-c', "insert into public.contact_inquiries(name,email,phone,message,first_name) values ('Keep','k@example.invalid','1','m','Me')"]);
    const before = state(db2);
    for (const f of [GRANT, UPGRADE, ENSURE]) ok(`executed/dev-like: ${f} applies strictly`, apply(db2, read(DIR + f)).status === 0);
    const after = state(db2);
    ok('executed/dev-like: the schema and privileges are identical before and after', JSON.stringify(before) === JSON.stringify(after));
    finalOk('executed/dev-like', after);
    ok('executed/dev-like: existing rows are preserved', psql(db2, ['-c', "select count(*) from public.contact_inquiries where name='Keep' and first_name='Me'"]).stdout.trim() === '1');

    // 3. Older base table with no invoice columns.
    const db3 = fresh('base');
    apply(db3, read(DIR + CREATE));
    ok('executed/base: starts with 9 columns and no invoice columns', state(db3).cols === 9 && state(db3).invoiceCols === 0);
    for (const f of [GRANT, UPGRADE, ENSURE]) ok(`executed/base: ${f} applies strictly`, apply(db3, read(DIR + f)).status === 0);
    finalOk('executed/base', state(db3));

    // 4. Reapplication.
    const snapshot = JSON.stringify(state(db3));
    for (const f of [ENSURE, ENSURE, GRANT, UPGRADE]) ok(`executed/reapply: ${f} applies again`, apply(db3, read(DIR + f)).status === 0);
    ok('executed/reapply: nothing changed', JSON.stringify(state(db3)) === snapshot);

    // 5. A real failure is not hidden: a missing role must still raise.
    const db5 = fresh('norole');
    apply(db5, read(DIR + CREATE));
    psql(db5, ['-c', 'drop role if exists svc_missing_probe']);
    const bad = apply(db5, read(DIR + GRANT).replace('TO service_role', 'TO svc_missing_probe'));
    ok('executed: a genuine failure inside the guarded block still raises (nothing is swallowed)', bad.status !== 0 && /svc_missing_probe/.test(bad.stderr));
  } finally {
    for (const d of dbs) psql('postgres', ['-c', `drop database if exists ${d} with (force)`]);
  }
}

console.log(`contact_inquiries migrations: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed) process.exit(1);
