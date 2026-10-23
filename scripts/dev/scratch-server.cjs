'use strict';
// A scratch PostgreSQL that belongs to the verification pipeline ALONE, so nothing else can replace it or drop its databases.
//
//   node scripts/dev/scratch-server.cjs status     is it running, and which databases does it hold?
//   node scripts/dev/scratch-server.cjs start      create (first time) and start it; does nothing when it is already running
//   node scripts/dev/scratch-server.cjs build      (re)build the bpc_replay_* databases in it (scripts/dev/security-scratch.cjs build)
//   node scripts/dev/scratch-server.cjs ensure     start + build whatever is missing OR older than the repository migrations: makes the pipeline ready
//   node scripts/dev/scratch-server.cjs stop       stop it (the data stays)
//
// Why it exists: the shared scratch server on port 54329 has been started by hand inside one session's temporary folder, and was replaced
// by another session's server three times in one week, taking the databases with it. This server has its own port (default 54339,
// BPC_PIPELINE_PORT to change it) and its own folder OUTSIDE any session and the repository:
//   %LOCALAPPDATA%\bpc-pipeline-pg\   data\ (the cluster) and server.log
// It listens on 127.0.0.1 only, trusts local connections (like the other scratch servers) and never talks to a Supabase project.
// It is an ordinary process, not a Windows service (that would need administrator rights): after a reboot the first run of
// verify / run-tests / the mutation runner starts it again by itself (scratch-env's preflight calls start); `ensure` also rebuilds.
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BIN = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const PORT = String(process.env.BPC_PIPELINE_PORT || 54339);
const HOME = path.join(process.env.LOCALAPPDATA || os.homedir(), 'bpc-pipeline-pg');
const DATA = path.join(HOME, 'data');
const LOG = path.join(HOME, 'server.log');
const STAMPS = path.join(HOME, 'stamps.json');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const exe = (name) => path.join(BIN, name + (process.platform === 'win32' ? '.exe' : ''));

function psql(sql, db = 'postgres') {
  return spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', db, '-X', '-q', '-w', '-Atc', sql], { encoding: 'utf8', timeout: 20000 });
}
const isUp = () => {
  const r = psql('select 1');
  return r.status === 0 && r.stdout.trim() === '1';
};
const databases = () => {
  const r = psql("select datname from pg_database where datname like 'bpc_replay_%' order by 1");
  return r.status === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : [];
};

function init() {
  if (fs.existsSync(path.join(DATA, 'PG_VERSION'))) return;
  fs.mkdirSync(HOME, { recursive: true });
  console.log(`creating the pipeline scratch cluster in ${DATA}`);
  const r = spawnSync(exe('initdb'), ['-D', DATA, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8'], { encoding: 'utf8' });
  if (r.status !== 0) { console.error((r.stdout || '') + (r.stderr || '')); process.exit(2); }
}

function start() {
  if (isUp()) return true;
  init();
  const listening = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout || '';
  if (new RegExp(`127\\.0\\.0\\.1:${PORT}\\s+\\S+\\s+LISTENING`).test(listening)) {
    console.error(`Port ${PORT} is taken by something that is not answering as the pipeline server. Set BPC_PIPELINE_PORT to a free port.`);
    return false;
  }
  console.log(`starting the pipeline scratch server on 127.0.0.1:${PORT}`);
  // The output is NOT captured: the server keeps running after pg_ctl returns and would hold a captured pipe open, so this call would never
  // return. Everything the server says goes to its log file (-l).
  const r = spawnSync(exe('pg_ctl'), ['-D', DATA, '-l', LOG, '-o', `-p ${PORT} -c listen_addresses=127.0.0.1`, 'start', '-w', '-t', '60'], { stdio: 'ignore' });
  if (r.status !== 0) { console.error(`pg_ctl could not start the server; see ${LOG}`); return false; }
  return isUp();
}

function stop() {
  if (!fs.existsSync(path.join(DATA, 'PG_VERSION'))) return console.log('nothing to stop: the pipeline scratch cluster does not exist');
  const r = spawnSync(exe('pg_ctl'), ['-D', DATA, 'stop', '-m', 'fast', '-w'], { encoding: 'utf8' });
  console.log(((r.stdout || '') + (r.stderr || '')).trim());
}

// What each database was built from. The stamp lives in a file NEXT TO the cluster, not inside the databases: migration-replay checks a marker
// comment on them before it drops one, and the tests clone them as templates, so nothing may be added to them.
// A database replays the repository migrations up to its own version (`upto`; null = all of them): its stamp is the digest of exactly those files.
function migrationState(upto) {
  let names = [];
  try { names = fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort(); } catch { /* no migrations folder */ }
  if (upto) names = names.filter((n) => n.split('_')[0] <= upto);
  const h = crypto.createHash('sha1');
  for (const n of names) h.update(n + '\0').update(fs.readFileSync(path.join(MIGRATIONS, n)));
  return { through: names.length ? names[names.length - 1].split('_')[0] : null, count: names.length, digest: h.digest('hex') };
}
const readStamps = () => { try { return JSON.parse(fs.readFileSync(STAMPS, 'utf8')); } catch { return {}; } };
function writeStamps(builtFrom, names) {
  const stamps = readStamps();
  const oids = {};
  const r = psql("select datname || '=' || oid from pg_database where datname like 'bpc_replay_%'");
  for (const l of (r.stdout || '').split(/\r?\n/).filter(Boolean)) oids[l.split('=')[0]] = l.split('=')[1];
  for (const [name, upto] of require('./security-scratch.cjs').DATABASES) {
    if (oids[name] && (!names || names.includes(name))) stamps[name] = { ...builtFrom(upto), oid: oids[name], builtAt: new Date().toISOString() };
  }
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(STAMPS, JSON.stringify(stamps, null, 2));
}
// -> [{ name, why }] for databases older than (or not provably equal to) the repository migrations they stand for
function staleDatabases() {
  const stamps = readStamps();
  const have = databases();
  const out = [];
  for (const [name, upto] of require('./security-scratch.cjs').DATABASES) {
    if (!have.includes(name)) continue; // a missing database is reported separately
    const st = stamps[name];
    const now = migrationState(upto);
    if (!st) out.push({ name, why: 'no record of which migrations it was built from' });
    else if (st.digest !== now.digest) out.push({ name, why: `built through ${st.through} (${st.count} migrations); the repository now has ${now.through} (${now.count})` });
  }
  return out;
}

// only: the names of the databases to rebuild (null = all six)
function build(only = null) {
  // the migrations are read when the build STARTS, so a file added while it runs is reported as stale afterwards
  const startedFrom = {};
  for (const [, upto] of require('./security-scratch.cjs').DATABASES) startedFrom[upto] = migrationState(upto);
  const sec = require('./security-scratch.cjs');
  const r = spawnSync('node', ['scripts/dev/security-scratch.cjs', 'build'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PGPORT: PORT, BPC_SCRATCH_ONLY: only ? only.join(',') : '' } });
  const ok = r.status === 0 && sec.DATABASES.every((d) => databases().includes(d[0]));
  if (ok) writeStamps((upto) => startedFrom[upto], only);
  return ok;
}

function missingDatabases() {
  const have = databases();
  return require('./security-scratch.cjs').DATABASES.map((d) => d[0]).filter((d) => !have.includes(d));
}

module.exports = { PORT, HOME, DATA, LOG, STAMPS, isUp, start, stop, build, databases, missingDatabases, staleDatabases, migrationState };

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'status') {
    const up = isUp();
    console.log(`pipeline scratch server: ${up ? 'RUNNING' : 'not running'} on 127.0.0.1:${PORT}   data: ${DATA}`);
    if (up) {
      const have = databases(); console.log(`databases (${have.length}): ${have.join(', ') || 'none'}`);
      const stale = staleDatabases();
      if (!stale.length) console.log('all databases match the repository migrations');
      else {
        console.log('OLDER THAN THE REPOSITORY MIGRATIONS:');
        stale.forEach((x) => console.log(`  ${x.name}: ${x.why}`));
        console.log('rebuild:   node scripts/dev/scratch-server.cjs ensure');
      }
    }
    process.exit(up ? 0 : 1);
  } else if (cmd === 'start') {
    process.exit(start() ? 0 : 1);
  } else if (cmd === 'stop') {
    stop();
  } else if (cmd === 'build' || cmd === 'ensure') {
    // A build drops and recreates the databases every database-backed test runs against, so it takes its turn in the same queue as the tests.
    (async () => {
      if (!start()) process.exit(1);
      await require('./queue-lock.cjs').acquire('db-tests', 'the database tests of another run (a rebuild replaces the scratch databases)');
      const miss = missingDatabases();
      const stale = cmd === 'ensure' ? staleDatabases() : [];
      const names = cmd === 'build' ? null : [...new Set([...miss, ...stale.map((x) => x.name)])];
      if (cmd === 'build' || miss.length || stale.length) {
        if (miss.length) console.log(`missing: ${miss.join(', ')}`);
        stale.forEach((x) => console.log(`older than the migrations: ${x.name}: ${x.why}`));
        console.log(names ? `rebuilding ${names.length} of ${require('./security-scratch.cjs').DATABASES.length} databases (${names.join(', ')}); about 2 minutes each` : 'building all six databases (about 13 minutes)');
        if (!build(names)) process.exit(1);
      }
      const left = missingDatabases();
      console.log(left.length ? `STILL MISSING: ${left.join(', ')}` : `ready on 127.0.0.1:${PORT}: all required databases are present and match the repository migrations`);
      process.exit(left.length ? 1 : 0);
    })();
  } else {
    console.error('usage: node scripts/dev/scratch-server.cjs status | start | build | ensure | stop');
    process.exit(2);
  }
}
