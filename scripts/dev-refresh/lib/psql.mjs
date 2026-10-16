// Thin wrapper around the PostgreSQL command-line client. The tool talks to databases only through psql: no driver dependency,
// and the same client the repository's database tests already use. Passwords go in the child's environment, never on a command line.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { PROJECTS, SCRATCH_DB_PREFIX, SCRATCH_HOSTS } from './config.mjs';

const PSQL_CANDIDATES = [process.env.DEV_REFRESH_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean);

let cachedPsql = null;
export function findPsql() {
  if (cachedPsql) return cachedPsql;
  for (const c of PSQL_CANDIDATES) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return (cachedPsql = c);
  }
  throw new Error('psql was not found. Install the PostgreSQL client tools or set DEV_REFRESH_PSQL to the psql executable.');
}

// A target is one database the tool may talk to.
//   { role: 'prod' | 'dev', host, port, user, password, database, sslmode, scratch }
export function targetFromUrl(role, url, { scratch = false } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`The ${role} connection string is not a valid postgresql:// URL.`);
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error(`The ${role} connection string must start with postgresql://`);
  return {
    role,
    host: u.hostname.replace(/^\[|\]$/g, ''),
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
    sslmode: u.searchParams.get('sslmode') || (SCRATCH_HOSTS.includes(u.hostname) ? 'disable' : 'require'),
    scratch,
  };
}

export function describeTarget(t) {
  return `${t.role}: ${t.user}@${t.host}:${t.port}/${t.database}${t.scratch ? ' (scratch)' : ''}`;
}

// The project ref a hosted connection belongs to: "postgres.<ref>" (pooler user) or "db.<ref>.supabase.co" (direct host).
export function refOfTarget(t) {
  const fromUser = t.user.match(/^[^.]+\.([a-z]{20})$/);
  if (fromUser) return fromUser[1];
  const fromHost = t.host.match(/^db\.([a-z]{20})\.supabase\.co$/);
  if (fromHost) return fromHost[1];
  return null;
}

// Refuses a target that is not demonstrably the database its role says. Pure; no connection needed.
export function assertTargetIdentity(t) {
  if (t.scratch) {
    if (!SCRATCH_HOSTS.includes(t.host)) throw new Error(`Scratch target ${describeTarget(t)} is not on this machine.`);
    if (!t.database.startsWith(SCRATCH_DB_PREFIX)) throw new Error(`Scratch database names must start with "${SCRATCH_DB_PREFIX}" (got "${t.database}").`);
    if (t.role === 'prod' && !t.database.endsWith('_prod')) throw new Error(`Scratch "prod" database "${t.database}" must end with "_prod".`);
    if (t.role === 'dev' && !t.database.endsWith('_dev')) throw new Error(`Scratch "dev" database "${t.database}" must end with "_dev".`);
    return { ref: null };
  }
  const expected = PROJECTS[t.role]?.ref;
  const other = PROJECTS[t.role === 'prod' ? 'dev' : 'prod'].ref;
  const ref = refOfTarget(t);
  if (!ref) throw new Error(`Cannot tell which Supabase project the ${t.role} connection points at (expected user "postgres.<ref>" or host "db.<ref>.supabase.co").`);
  if (ref === other) throw new Error(`The ${t.role} connection points at the ${PROJECTS[t.role === 'prod' ? 'dev' : 'prod'].label} project. Refusing.`);
  if (ref !== expected) throw new Error(`The ${t.role} connection points at project ${ref}, not ${expected}. Refusing.`);
  return { ref };
}

function envFor(t) {
  const env = { ...process.env, PGHOST: t.host, PGPORT: String(t.port), PGUSER: t.user, PGDATABASE: t.database, PGSSLMODE: t.sslmode, PGCONNECT_TIMEOUT: '20' };
  if (t.password) env.PGPASSWORD = t.password;
  else delete env.PGPASSWORD;
  // Production is opened read-only at the SESSION level, so even a statement that forgot BEGIN READ ONLY cannot write.
  if (t.role === 'prod') env.PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=300000';
  else env.PGOPTIONS = '-c statement_timeout=900000';
  return env;
}

// Runs a SQL script (which may use psql meta-commands such as \copy) on a target. Returns { status, stdout, stderr }.
export function runScript(t, script, { cwd } = {}) {
  const r = spawnSync(findPsql(), ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: script,
    env: envFor(t),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    cwd,
  });
  return { status: r.status, stdout: (r.stdout || '').replace(/\r/g, ''), stderr: (r.stderr || '').replace(/\r/g, '') };
}

export function mustRun(t, script, what) {
  const r = runScript(t, script);
  if (r.status !== 0) {
    const err = new Error(`${what} failed on the ${t.role} database:\n${redact(r.stderr.trim() || r.stdout.trim())}`);
    err.stdout = r.stdout;
    err.stderr = r.stderr;
    throw err;
  }
  return r;
}

// One JSON value out of a single query.
export function queryJson(t, sql, what = 'query') {
  const r = mustRun(t, `${sql.trim().replace(/;\s*$/, '')};`, what);
  const line = r.stdout.trim().split('\n').filter(Boolean).pop();
  if (!line) throw new Error(`${what} returned nothing`);
  return JSON.parse(line);
}

// Lines of the form "@@tag|a|b" printed by generated scripts.
export function markers(stdout) {
  const out = [];
  for (const line of stdout.split('\n')) {
    if (line.startsWith('@@')) out.push(line.slice(2).split('|'));
  }
  return out;
}

// Never echo a password or a connection string back into a report.
export function redact(text) {
  return String(text).replace(/(postgres(?:ql)?:\/\/[^:@\s]+:)[^@\s]+@/gi, '$1***@').replace(/password=\S+/gi, 'password=***');
}

export function sqlIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}
export function sqlLit(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
export function psqlPath(p) {
  const s = p.replace(/\\/g, '/');
  if (s.includes("'") || s.includes('\n')) throw new Error(`Unsupported character in path: ${s}`);
  return s;
}
export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}
