'use strict';
// A scratch PostgreSQL that belongs to the verification pipeline ALONE, so nothing else can replace it or drop its databases.
//
//   node scripts/dev/scratch-server.cjs status     is it running, and which databases does it hold?
//   node scripts/dev/scratch-server.cjs start      create (first time) and start it; does nothing when it is already running
//   node scripts/dev/scratch-server.cjs build      (re)build the bpc_replay_* databases in it (scripts/dev/security-scratch.cjs build)
//   node scripts/dev/scratch-server.cjs ensure     start + build whatever is missing: the one command that makes the pipeline ready
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
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BIN = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const PORT = String(process.env.BPC_PIPELINE_PORT || 54339);
const HOME = path.join(process.env.LOCALAPPDATA || os.homedir(), 'bpc-pipeline-pg');
const DATA = path.join(HOME, 'data');
const LOG = path.join(HOME, 'server.log');
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

function build() {
  const sec = require('./security-scratch.cjs');
  const r = spawnSync('node', ['scripts/dev/security-scratch.cjs', 'build'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PGPORT: PORT } });
  return r.status === 0 && sec.DATABASES.every((d) => databases().includes(d[0]));
}

function missingDatabases() {
  const have = databases();
  return require('./security-scratch.cjs').DATABASES.map((d) => d[0]).filter((d) => !have.includes(d));
}

module.exports = { PORT, HOME, DATA, LOG, isUp, start, stop, build, databases, missingDatabases };

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'status') {
    const up = isUp();
    console.log(`pipeline scratch server: ${up ? 'RUNNING' : 'not running'} on 127.0.0.1:${PORT}   data: ${DATA}`);
    if (up) { const have = databases(); console.log(`databases (${have.length}): ${have.join(', ') || 'none'}`); }
    process.exit(up ? 0 : 1);
  } else if (cmd === 'start') {
    process.exit(start() ? 0 : 1);
  } else if (cmd === 'stop') {
    stop();
  } else if (cmd === 'build') {
    if (!start()) process.exit(1);
    process.exit(build() ? 0 : 1);
  } else if (cmd === 'ensure') {
    if (!start()) process.exit(1);
    const miss = missingDatabases();
    if (miss.length) { console.log(`missing: ${miss.join(', ')} -> building (this takes several minutes)`); if (!build()) process.exit(1); }
    const left = missingDatabases();
    console.log(left.length ? `STILL MISSING: ${left.join(', ')}` : `ready on 127.0.0.1:${PORT}: all required databases are present`);
    process.exit(left.length ? 1 : 0);
  } else {
    console.error('usage: node scripts/dev/scratch-server.cjs status | start | build | ensure | stop');
    process.exit(2);
  }
}
