// Safety of scripts/dev/migration-replay.cjs.
//
// The replay tool drops and recreates a scratch database. These tests make sure it can only ever be pointed at a scratch database
// on a verified local PostgreSQL, and that infrastructure failures can never be reported as a migration result.
//
//   PURE      the validators are called directly with safe and deliberately unsafe values (no database, no network).
//   CLI       the real script is launched with unsafe arguments and a psql path that does not exist, which proves that a refused run
//             never reaches psql (a run that DID try to connect would report an infrastructure error instead of a refusal).
//   STATIC    the source is checked for the safeguards that cannot be exercised without a database (marker check before the drop,
//             quoted identifiers, verdict wording).
//
// No test connects to any database, hosted or local, and nothing here drops anything.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/security/migrationReplaySafety.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined>; execPath: string; exit(code: number): never };
const fs = require('fs');
const { spawnSync } = require('child_process');
const replay = require('../../../../scripts/dev/migration-replay.cjs');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// PURE: database names
// ---------------------------------------------------------------------------------------------------------------
for (const good of ['bpc_replay_check', 'bpc_replay_a1_b2', 'bpc_replay_strict_01', 'bpc_replay_' + 'a'.repeat(32)]) {
  ok(`name accepted: ${good}`, replay.validateDbName(good).ok === true);
}
const BAD_NAMES: Array<[string, unknown]> = [
  ['empty', ''],
  ['undefined', undefined],
  ['number', 123],
  ['postgres (the maintenance database)', 'postgres'],
  ['template0', 'template0'],
  ['template1', 'template1'],
  ['an application-style name', 'bounce_party_club'],
  ['no prefix', 'scratch'],
  ['old tool prefix', 'mr_scratch'],
  ['prefix only', 'bpc_replay_'],
  ['upper case', 'BPC_REPLAY_X'],
  ['mixed case', 'bpc_replay_Check'],
  ['space inside', 'bpc_replay_a b'],
  ['leading space', ' bpc_replay_x'],
  ['trailing newline', 'bpc_replay_x\n'],
  ['injection with semicolon', 'bpc_replay_x; drop database postgres'],
  ['double quote', 'bpc_replay_"x'],
  ['single quote', "bpc_replay_x'"],
  ['backslash', 'bpc_replay_x\\y'],
  ['path traversal', '../bpc_replay_x'],
  ['slash', 'bpc_replay_x/y'],
  ['non-ASCII letter', 'bpc_replay_\u00e9'],
  ['too long (33 characters after the prefix)', 'bpc_replay_' + 'a'.repeat(33)],
  ['Development project reference', 'srxunxiytojjsuhcmzjg'],
  ['Production project reference', 'qaagfafagdpgzcijnfbw'],
  ['prefix + Development project reference', 'bpc_replay_srxunxiytojjsuhcmzjg'],
  ['prefix + Production project reference', 'bpc_replay_qaagfafagdpgzcijnfbw'],
  ['production-like word', 'bpc_replay_production'],
  ['prod_ word', 'bpc_replay_prod_copy'],
  ['_prod word', 'bpc_replay_copy_prod'],
  ['development word', 'bpc_replay_development'],
  ['supabase word', 'bpc_replay_supabase'],
  ['postgres word', 'bpc_replay_postgres'],
  ['template word', 'bpc_replay_template'],
];
for (const [what, value] of BAD_NAMES) {
  ok(`unsafe name rejected: ${what}`, replay.validateDbName(value).ok === false);
}

// ---------------------------------------------------------------------------------------------------------------
// PURE: connection target
// ---------------------------------------------------------------------------------------------------------------
for (const good of ['127.0.0.1', '::1', 'localhost']) ok(`host accepted: ${good}`, replay.validateHost(good).ok === true);
for (const bad of [
  '',
  'db.srxunxiytojjsuhcmzjg.supabase.co',
  'db.qaagfafagdpgzcijnfbw.supabase.co',
  'aws-0-us-east-1.pooler.supabase.com',
  'srxunxiytojjsuhcmzjg.supabase.co',
  '10.0.0.5',
  '192.168.1.20',
  '0.0.0.0',
  '127.0.0.2',
  'localhost.evil.example',
  '127.0.0.1.evil.example',
  'LOCALHOST',
  'localhost ',
]) {
  ok(`unsafe host rejected: ${JSON.stringify(bad)}`, replay.validateHost(bad).ok === false);
}
for (const good of ['54329', '5432', 65535]) ok(`port accepted: ${good}`, replay.validatePort(good).ok === true);
for (const bad of ['', '80', 'abc', '99999', '54329; x', '-1', '1023', '5432.5']) ok(`unsafe port rejected: ${JSON.stringify(bad)}`, replay.validatePort(bad).ok === false);
for (const good of ['postgres', 'scratch_admin']) ok(`user accepted: ${good}`, replay.validateUser(good).ok === true);
for (const bad of ['supabase_admin', 'supabase_auth_admin', 'postgres; drop', '', 'Postgres', 'a b']) ok(`unsafe user rejected: ${JSON.stringify(bad)}`, replay.validateUser(bad).ok === false);

// ---------------------------------------------------------------------------------------------------------------
// PURE: environment that could redirect the connection, and the explicit local confirmation
// ---------------------------------------------------------------------------------------------------------------
ok('no confirmation: refused', replay.validateEnvironment({}).ok === false);
ok('wrong confirmation: refused', replay.validateEnvironment({ BPC_REPLAY_CONFIRM_LOCAL: 'true' }).ok === false);
ok('confirmation on a clean environment: accepted', replay.validateEnvironment({ BPC_REPLAY_CONFIRM_LOCAL: 'yes' }).ok === true);
for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'DATABASE_URL', 'POSTGRES_URL']) {
  ok(`${key} is rejected even with the confirmation`, replay.validateEnvironment({ BPC_REPLAY_CONFIRM_LOCAL: 'yes', [key]: 'x' }).ok === false);
}

// ---------------------------------------------------------------------------------------------------------------
// PURE: identifier quoting
// ---------------------------------------------------------------------------------------------------------------
ok('quoteIdent wraps in double quotes', replay.quoteIdent('bpc_replay_x') === '"bpc_replay_x"');
ok('quoteIdent doubles embedded quotes', replay.quoteIdent('a"b') === '"a""b"');
ok('quoteIdent keeps an injection attempt inside one identifier', replay.quoteIdent('x"; drop database postgres; --') === '"x""; drop database postgres; --"');
ok('quoteLiteral doubles single quotes', replay.quoteLiteral("a'b") === "'a''b'");
ok('quoteLiteral keeps an injection attempt inside one literal', replay.quoteLiteral("x'; drop database postgres; --") === "'x''; drop database postgres; --'");

// ---------------------------------------------------------------------------------------------------------------
// PURE: infrastructure failures are not migration results
// ---------------------------------------------------------------------------------------------------------------
ok('spawn error (psql missing) is infrastructure', replay.isInfrastructureFailure({ error: new Error('ENOENT'), status: null, stderr: '' }) === true);
ok('missing result is infrastructure', replay.isInfrastructureFailure(undefined) === true);
ok('psql connection failure (status 2) is infrastructure', replay.isInfrastructureFailure({ status: 2, stderr: 'psql: error: connection to server at "127.0.0.1" failed' }) === true);
ok('server closed the connection is infrastructure', replay.isInfrastructureFailure({ status: 1, stderr: 'server closed the connection unexpectedly' }) === true);
ok('an ordinary SQL error with continue-on-error is NOT infrastructure', replay.isInfrastructureFailure({ status: 0, stderr: 'ERROR:  relation "x" does not exist' }) === false);
ok('a SQL error that stopped the script (status 3) is NOT infrastructure', replay.isInfrastructureFailure({ status: 3, stderr: 'ERROR:  syntax error' }) === false);

// ---------------------------------------------------------------------------------------------------------------
// CLI: the real script, unsafe inputs, and a psql that does not exist
// ---------------------------------------------------------------------------------------------------------------
const SCRIPT = 'scripts/dev/migration-replay.cjs';
function runCli(args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', PGPSQL: 'Z:/this/psql/does/not/exist', ...env },
    timeout: 60000,
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const CONFIRM = { BPC_REPLAY_CONFIRM_LOCAL: 'yes' };
let c = runCli([], CONFIRM);
ok('CLI: no --db is refused (exit 2)', c.status === 2 && /REFUSED/.test(c.out));
c = runCli(['--db', 'postgres'], CONFIRM);
ok('CLI: --db postgres is refused (exit 2) before any connection', c.status === 2 && /REFUSED/.test(c.out) && !/INFRASTRUCTURE/.test(c.out));
c = runCli(['--db', 'srxunxiytojjsuhcmzjg'], CONFIRM);
ok('CLI: the Development project reference is refused', c.status === 2 && /REFUSED/.test(c.out) && !/INFRASTRUCTURE/.test(c.out));
c = runCli(['--db', 'qaagfafagdpgzcijnfbw'], CONFIRM);
ok('CLI: the Production project reference is refused', c.status === 2 && /REFUSED/.test(c.out) && !/INFRASTRUCTURE/.test(c.out));
c = runCli(['--db', 'bpc_replay_x'], {});
ok('CLI: a valid name without BPC_REPLAY_CONFIRM_LOCAL=yes is refused', c.status === 2 && /REFUSED/.test(c.out) && !/INFRASTRUCTURE/.test(c.out));
c = runCli(['--db', 'bpc_replay_x'], { ...CONFIRM, PGHOST: 'db.srxunxiytojjsuhcmzjg.supabase.co' });
ok('CLI: a hosted Supabase host is refused', c.status === 2 && /not a loopback/.test(c.out) && !/INFRASTRUCTURE/.test(c.out));
c = runCli(['--db', 'bpc_replay_x'], { ...CONFIRM, PGHOST: 'aws-0-us-east-1.pooler.supabase.com' });
ok('CLI: a Supabase pooler host is refused', c.status === 2 && /not a loopback/.test(c.out));
c = runCli(['--db', 'bpc_replay_x'], { ...CONFIRM, PGHOST: '10.1.2.3' });
ok('CLI: a private-network host is refused', c.status === 2 && /not a loopback/.test(c.out));
c = runCli(['--db', 'bpc_replay_x'], { ...CONFIRM, PGSERVICE: 'prod' });
ok('CLI: PGSERVICE is refused', c.status === 2 && /PGSERVICE/.test(c.out) && !/INFRASTRUCTURE/.test(c.out));
c = runCli(['--db', 'bpc_replay_x'], { ...CONFIRM, PGHOSTADDR: '1.2.3.4' });
ok('CLI: PGHOSTADDR is refused', c.status === 2 && /PGHOSTADDR/.test(c.out));
c = runCli(['--db', 'bpc_replay_x'], { ...CONFIRM, DATABASE_URL: 'postgres://u:p@db.example/postgres' });
ok('CLI: DATABASE_URL is refused', c.status === 2 && /DATABASE_URL/.test(c.out));
c = runCli(['--db', 'bpc_replay_x'], { ...CONFIRM, PGUSER: 'supabase_admin' });
ok('CLI: a supabase_* user is refused', c.status === 2 && /not an acceptable local role/.test(c.out));
c = runCli(['--db', 'bpc_replay_x', '--mode', 'bogus'], CONFIRM);
ok('CLI: an unknown --mode is refused', c.status === 2 && /--mode/.test(c.out));
c = runCli(['--db', 'bpc_replay_x', '--upto', 'abc'], CONFIRM);
ok('CLI: a malformed --upto is refused', c.status === 2 && /--upto/.test(c.out));
// A fully valid request against a psql that cannot run: an infrastructure error, never a migration verdict.
for (const mode of ['diagnostic', 'strict']) {
  c = runCli(['--db', 'bpc_replay_x', '--mode', mode], CONFIRM);
  ok(`CLI (${mode}): a failed connection stops with exit 2 and an infrastructure error`, c.status === 2 && /INFRASTRUCTURE ERROR/.test(c.out) && /no migration result was produced/.test(c.out));
  ok(`CLI (${mode}): no success wording is printed when the infrastructure fails`, !/STRICT REPLAY COMPLETED|DIAGNOSTIC completed|files replayed/.test(c.out));
}

// ---------------------------------------------------------------------------------------------------------------
// STATIC: safeguards that need a database to run
// ---------------------------------------------------------------------------------------------------------------
const src: string = fs.readFileSync(SCRIPT, 'utf8');
ok('static: exactly one DROP DATABASE statement exists', (src.match(/drop database/gi) || []).length === 1);
ok('static: the DROP DATABASE uses the quoted identifier', /drop database if exists \$\{quoteIdent\(args\.db\)\}/.test(src));
ok('static: the marker comparison happens before the DROP', src.indexOf('!== MARKER') > 0 && src.indexOf('!== MARKER') < src.indexOf('drop database'));
ok('static: the server is inspected (loopback, Supabase markers) before the DROP', src.indexOf('inet_server_addr') > 0 && src.indexOf('inet_server_addr') < src.indexOf('drop database'));
ok('static: every infrastructure step stops the run with its own error', /infra\('drop scratch database'|\['drop scratch database'/.test(src) && /infra\(what, r\)/.test(src));
ok('static: the child process environment is rebuilt, not inherited', /const childEnv = \{ PATH: env\.PATH/.test(src) && !/env: process\.env/.test(src));
ok('static: strict mode uses one transaction per file and stops at the first failure', /ON_ERROR_STOP=1', '-1', '-f'/.test(src) && /if \(strict\) break;/.test(src));
ok('static: diagnostic mode never prints a pass verdict', /this is not a migration pass/.test(src) && /NOT a strict rehearsal/.test(src));
ok('static: the output always says the environment is not Supabase', /not a Supabase project or a full Supabase rehearsal/.test(src));
ok('static: a skipped stub-limited file is labelled as not a pass', /a skipped file is not a pass/.test(src));

console.log(`migration replay safety: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
