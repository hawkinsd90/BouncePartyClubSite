'use strict';
// Replays supabase/migrations (version order) into a THROWAWAY database on a LOCAL scratch PostgreSQL and reports which files raise
// errors. It never connects to a Supabase project, and it refuses every database that it did not create itself.
//
// Two modes, deliberately named differently so a result cannot be mistaken for the other:
//   diagnostic (default)  every file runs on its own, a failing file does not stop the run, and ALL failing files are listed. The run
//                         can never print a success verdict: even with zero errors it only says "diagnostic ... not a rehearsal".
//   strict                each file runs as ONE transaction with ON_ERROR_STOP and the run stops at the FIRST failing file, the way
//                         `supabase db reset` does. Only a strict run that completes every file may print "STRICT REPLAY COMPLETED",
//                         and it still says it ran against a stub environment, not Supabase.
//
//   node scripts/dev/migration-replay.cjs --db bpc_replay_check                         diagnostic
//   node scripts/dev/migration-replay.cjs --db bpc_replay_check --mode strict           strict
//   node scripts/dev/migration-replay.cjs --db bpc_replay_check --upto 20260814120100   stop after this version
//   node scripts/dev/migration-replay.cjs --db bpc_replay_check --mode strict --stub-skips   skip the documented stub-limited file(s)
//   add --report <file> to also write the result to a file
//
// Safety rules (each is enforced before anything is dropped or created):
//   - the database name must match ^bpc_replay_[a-z0-9_]{1,32}$ and must not contain a hosted project reference or a production-like word;
//   - the server must be on a loopback address, you must confirm it with BPC_REPLAY_CONFIRM_LOCAL=yes, and it must NOT look like a
//     Supabase server (no login-capable supabase_* roles, no Supabase-only extensions in the maintenance database);
//   - connection strings, PGSERVICE and PGHOSTADDR are rejected so the host cannot be redirected;
//   - an existing database is only dropped when it carries this tool's marker comment;
//   - a failed drop / create / bootstrap stops the run (exit code 2) instead of producing a misleading migration result.
// Exit codes: 0 completed without errors (see the mode wording), 1 migration errors found, 2 refused / infrastructure error.
//
// Connection: PGHOST (default 127.0.0.1), PGPORT (default 54329), PGUSER (default postgres), PGPSQL (path to psql).
// Known stub-only limitation: 20260323201502 needs the pg_net extension, which a plain PostgreSQL cannot install.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NAME_RE = /^bpc_replay_[a-z0-9_]{1,32}$/;
const MARKER = 'bpc-migration-replay-scratch:v1';
const HOSTED_FRAGMENTS = ['srxunxiytojjsuhcmzjg', 'qaagfafagdpgzcijnfbw', 'supabase', 'postgres', 'template', 'production', 'prod_', '_prod', 'development'];
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const HOSTED_EXTENSIONS = ['pg_graphql', 'supabase_vault', 'pgsodium', 'pg_net', 'pgjwt', 'supabase_wrappers'];
const STUB_LIMITED = { '20260323201502': 'needs the pg_net extension, which plain PostgreSQL cannot install' };
const REDIRECTING_ENV = ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'DATABASE_URL', 'POSTGRES_URL'];

// ---- pure validators (exported for tests) -------------------------------------------------------------------------------------
function validateDbName(name) {
  if (typeof name !== 'string' || name.length === 0) return { ok: false, reason: 'database name is required (--db)' };
  if (name !== name.trim() || /[\s"'`;\\\/]/.test(name)) return { ok: false, reason: 'database name contains whitespace, quotes, a semicolon or a slash' };
  if (!NAME_RE.test(name)) return { ok: false, reason: `database name must match ${NAME_RE} (lowercase letters, digits, underscore; prefix "bpc_replay_")` };
  const lower = name.toLowerCase();
  const hit = HOSTED_FRAGMENTS.find((f) => lower.includes(f));
  if (hit) return { ok: false, reason: `database name must not contain "${hit}" (reserved or hosted/production-like)` };
  return { ok: true };
}

function validateHost(host) {
  if (typeof host !== 'string' || host.length === 0) return { ok: false, reason: 'host is empty' };
  if (!LOOPBACK_HOSTS.has(host)) return { ok: false, reason: `host "${host}" is not a loopback address (only 127.0.0.1, ::1, localhost are allowed)` };
  return { ok: true };
}

function validatePort(port) {
  if (!/^\d{2,5}$/.test(String(port)) || Number(port) < 1024 || Number(port) > 65535) return { ok: false, reason: `port "${port}" is not a valid unprivileged port` };
  return { ok: true };
}

function validateUser(user) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(String(user)) || /supabase/i.test(String(user))) return { ok: false, reason: `user "${user}" is not an acceptable local role` };
  return { ok: true };
}

function validateEnvironment(env) {
  const bad = REDIRECTING_ENV.filter((k) => env[k]);
  if (bad.length) return { ok: false, reason: `${bad.join(', ')} can redirect the connection and is not allowed; use PGHOST / PGPORT / PGUSER` };
  if (env.BPC_REPLAY_CONFIRM_LOCAL !== 'yes') return { ok: false, reason: 'set BPC_REPLAY_CONFIRM_LOCAL=yes to confirm the target is a local scratch PostgreSQL' };
  return { ok: true };
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}
function quoteLiteral(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

// An error that is about the connection / tooling, not about the migration SQL.
function isInfrastructureFailure(result) {
  if (!result || result.error) return true;
  if (result.status === 2) return true; // psql: the connection to the server failed
  const text = result.stderr || '';
  return /could not connect|connection to server|server closed the connection|no such file or directory|is not recognized/i.test(text) && result.status !== 0;
}

// ---- command line -------------------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const get = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : dflt;
  };
  return {
    db: get('--db', ''),
    mode: get('--mode', 'diagnostic'),
    report: get('--report', ''),
    upto: get('--upto', ''),
    stubSkips: argv.includes('--stub-skips'),
  };
}

function refuse(message) {
  console.error('REFUSED: ' + message);
  return 2;
}

const STUBS = `
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'authenticator', 'supabase_admin', 'supabase_auth_admin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;
CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS storage; CREATE SCHEMA IF NOT EXISTS graphql_public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE PUBLICATION supabase_realtime;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE, encrypted_password text, email_confirmed_at timestamptz,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb, raw_app_meta_data jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(), last_sign_in_at timestamptz, phone text, is_anonymous boolean DEFAULT false, instance_id uuid, aud text,
  role text, confirmation_token text, recovery_token text, email_change_token_new text, email_change text, confirmed_at timestamptz);
CREATE TABLE auth.identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, provider_id text, identity_data jsonb, provider text,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.email', true), '')::text $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true), 'role', current_setting('request.jwt.claim.role', true), 'email', current_setting('request.jwt.claim.email', true)) $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), path_tokens text[]);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(name, '/') $$;
CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql AS $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
GRANT USAGE ON SCHEMA public, auth, storage, extensions TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
`;

// ---- main ---------------------------------------------------------------------------------------------------------------------
function main(argv, env) {
  const args = parseArgs(argv);
  if (args.mode !== 'diagnostic' && args.mode !== 'strict') return refuse(`--mode must be "diagnostic" or "strict" (got "${args.mode}")`);
  if (args.upto && !/^\d{14}$/.test(args.upto)) return refuse('--upto must be a 14-digit migration version');

  const name = validateDbName(args.db);
  if (!name.ok) return refuse(name.reason);
  const envCheck = validateEnvironment(env);
  if (!envCheck.ok) return refuse(envCheck.reason);
  const host = env.PGHOST || '127.0.0.1';
  const port = env.PGPORT || '54329';
  const user = env.PGUSER || 'postgres';
  for (const check of [validateHost(host), validatePort(port), validateUser(user)]) if (!check.ok) return refuse(check.reason);

  const PSQL = env.PGPSQL || 'psql';
  const baseArgs = ['-h', host, '-p', String(port), '-U', user, '-X', '-q', '-w'];
  const childEnv = { PATH: env.PATH, SystemRoot: env.SystemRoot, TEMP: env.TEMP, TMP: env.TMP, PGCLIENTENCODING: 'UTF8', PGPASSWORD: env.PGPASSWORD, PGCONNECT_TIMEOUT: '10' };
  const psql = (database, extra) => spawnSync(PSQL, [...baseArgs, '-d', database, ...extra], { encoding: 'utf8', env: childEnv, maxBuffer: 100 * 1024 * 1024 });
  const infra = (what, r) => {
    console.error(`INFRASTRUCTURE ERROR (${what}): no migration result was produced.`);
    console.error('  ' + String((r && (r.error ? r.error.message : r.stderr)) || 'unknown error').trim().split('\n').slice(0, 3).join('\n  '));
    return 2;
  };

  // 1. Verify the server really is a local scratch PostgreSQL, not a tunnel to a hosted Supabase project.
  let r = psql('postgres', ['-At', '-F', '|', '-c', "select coalesce(inet_server_addr()::text, 'unix'), (select string_agg(extname, ',') from pg_extension), (select string_agg(rolname, ',') from pg_roles where rolcanlogin and rolname like 'supabase%')"]);
  if (isInfrastructureFailure(r) || r.status !== 0) return infra('cannot connect to the local PostgreSQL', r);
  const [serverAddr, extensions = '', loginRoles = ''] = r.stdout.trim().split('|');
  if (serverAddr !== 'unix' && !/^(127\.0\.0\.1|::1)(\/\d+)?$/.test(serverAddr)) return refuse(`the server reports address ${serverAddr}, not loopback`);
  const hostedExt = HOSTED_EXTENSIONS.filter((e) => extensions.split(',').includes(e));
  if (hostedExt.length) return refuse(`the server has Supabase-only extensions (${hostedExt.join(', ')}); it looks like a hosted Supabase project`);
  if (loginRoles) return refuse(`the server has login-capable Supabase roles (${loginRoles}); it looks like a hosted Supabase project`);

  // 2. Only ever drop a database this tool created.
  const dbLiteral = quoteLiteral(args.db);
  r = psql('postgres', ['-At', '-c', `select 'exists:' || coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = ${dbLiteral}`]);
  if (r.status !== 0) return infra('cannot inspect the target database', r);
  const row = r.stdout.trim();
  const exists = row.startsWith('exists:');
  if (exists && row.slice('exists:'.length) !== MARKER) return refuse(`database ${args.db} already exists and was not created by this tool (no marker comment); it will not be dropped`);

  for (const [what, sql] of [
    ['drop scratch database', `drop database if exists ${quoteIdent(args.db)} with (force)`],
    ['create scratch database', `create database ${quoteIdent(args.db)}`],
    ['mark scratch database', `comment on database ${quoteIdent(args.db)} is ${quoteLiteral(MARKER)}`],
    ['set search_path', `alter database ${quoteIdent(args.db)} set search_path = public, extensions`],
  ]) {
    r = psql('postgres', ['-v', 'ON_ERROR_STOP=1', '-c', sql]);
    if (r.status !== 0 || r.error) return infra(what, r);
  }

  // 3. Bootstrap the Supabase-like stubs; any error here is an infrastructure error, not a migration result.
  r = psql(args.db, ['-v', 'ON_ERROR_STOP=1', '-c', STUBS]);
  if (r.status !== 0 || r.error || /ERROR/.test(r.stderr || '')) return infra('stub bootstrap', r);

  // 4. Replay.
  const DIR = path.resolve(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const lines = [];
  const skipped = [];
  let failing = 0;
  let replayed = 0;
  for (const f of files) {
    const version = f.slice(0, 14);
    if (args.upto && version > args.upto) break;
    if (args.stubSkips && STUB_LIMITED[version]) {
      skipped.push(`${version} (${STUB_LIMITED[version]})`);
      continue;
    }
    const strict = args.mode === 'strict';
    r = psql(args.db, strict ? ['-v', 'ON_ERROR_STOP=1', '-1', '-f', path.join(DIR, f)] : ['-v', 'ON_ERROR_STOP=0', '-f', path.join(DIR, f)]);
    if (isInfrastructureFailure(r)) return infra(`replaying ${f}`, r);
    replayed++;
    const errs = (r.stderr || '').split('\n').filter((l) => /ERROR:/.test(l)).map((l) => l.replace(/^psql:.*?:(\d+): /, 'line $1: ').slice(0, 170));
    if (errs.length || (strict && r.status !== 0)) {
      failing++;
      lines.push(`${version} ${f.slice(15)} :: ${errs.length} error(s) :: ${errs[0] || 'psql exited with status ' + r.status}`);
      if (strict) break;
    }
  }

  const modeLine = args.mode === 'strict' ? 'MODE: strict (one transaction per file, stop at the first failure)' : 'MODE: diagnostic (continues past failures; collects every failing file)';
  let verdict;
  if (failing) verdict = args.mode === 'strict' ? `STRICT REPLAY FAILED at ${lines[0].split(' ')[0]}` : `DIAGNOSTIC: ${failing} file(s) raised SQL errors (this is not a migration pass)`;
  else if (args.mode === 'strict') verdict = skipped.length ? `STRICT REPLAY COMPLETED with ${skipped.length} stub-limited file(s) SKIPPED (a skipped file is not a pass)` : 'STRICT REPLAY COMPLETED';
  else verdict = 'DIAGNOSTIC completed with no SQL errors; this is NOT a strict rehearsal and proves nothing about transactional behaviour';
  const out = [modeLine, `files replayed: ${replayed}${args.upto ? ` (up to ${args.upto})` : ''}`, ...(skipped.length ? [`skipped (stub-limited): ${skipped.join('; ')}`] : []), verdict, 'ENVIRONMENT: local plain-PostgreSQL stub of Supabase; not a Supabase project or a full Supabase rehearsal', ...lines.map((l) => '  ' + l)].join('\n');
  console.log(out);
  if (args.report) fs.writeFileSync(args.report, out + '\n');
  return failing ? 1 : 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2), process.env));
}
module.exports = { validateDbName, validateHost, validatePort, validateUser, validateEnvironment, quoteIdent, quoteLiteral, isInfrastructureFailure, parseArgs, NAME_RE, MARKER, STUB_LIMITED, main };
