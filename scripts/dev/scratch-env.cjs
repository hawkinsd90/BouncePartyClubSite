'use strict';
// The scratch databases the database-backed tests run against, in ONE place, plus a check that they are really there.
//
//   node scripts/dev/scratch-env.cjs check      is the scratch PostgreSQL answering, and does every required database exist? (exit 0 / 1)
//
// Which database a test file uses (and the environment variables that tell it) is defined once, in scripts/dev/security-scratch.cjs
// (envFor, DATABASES); run-tests, verify and the mutation runner all take it from here, so they cannot drift apart from the
// Step 3 security acceptance runner.
//
// Why a check exists: the scratch server is an ordinary process started by hand, not a service. A reboot, or another session starting
// its own server on the same port, silently removes the databases, and every database-backed test then fails with a confusing
// "scratch database ... is available" line. This turns that into one clear message at the start of a run, in about a second.
const { spawnSync } = require('child_process');
const server = require('./scratch-server.cjs');

// The pipeline uses its OWN scratch server (scripts/dev/scratch-server.cjs), not the shared one on 54329 that other sessions replace. PGPORT
// still wins when it is set (to run the same tests against another server on purpose). Must be decided before security-scratch is loaded.
const OWN_SERVER = !process.env.PGPORT || String(process.env.PGPORT) === String(server.PORT);
if (!process.env.PGPORT) process.env.PGPORT = server.PORT;
const sec = require('./security-scratch.cjs');

const REQUIRED = sec.DATABASES.map((d) => d[0]);

// the environment one test file needs (the same mapping the Step 3 acceptance uses)
const envFor = (file) => sec.envFor(file, false);

function psqlOn(db, sql) {
  return spawnSync(sec.psqlPath, ['-h', sec.PG.host, '-p', sec.PG.port, '-U', 'postgres', '-d', db, '-X', '-q', '-w', '-Atc', sql], { encoding: 'utf8', timeout: 20000 });
}

// -> { ok, problems: [string], missing: [db], server: boolean }
function preflight(databases = REQUIRED) {
  const where = `${sec.PG.host}:${sec.PG.port}`;
  let up = psqlOn('postgres', 'select 1');
  if ((up.status !== 0 || up.stdout.trim() !== '1') && OWN_SERVER && !process.env.NO_AUTOSTART) {
    // the pipeline's own server is a plain process: after a reboot it is simply not running. Start it (a few seconds).
    console.log('The pipeline scratch server is not running; starting it ...');
    if (server.start()) up = psqlOn('postgres', 'select 1');
  }
  if (up.status !== 0 || up.stdout.trim() !== '1') {
    return {
      ok: false,
      server: false,
      missing: databases.slice(),
      problems: [
        `No scratch PostgreSQL is answering on ${where}.`,
        OWN_SERVER
          ? 'Start the pipeline server and build its databases:   node scripts/dev/scratch-server.cjs ensure'
          : 'PGPORT points at another server. Start one there, then build the databases:   PGPORT=<port> node scripts/dev/security-scratch.cjs build',
      ],
    };
  }
  const missing = databases.filter((d) => {
    const r = psqlOn(d, "select to_regclass('public.orders') is not null");
    return !(r.status === 0 && r.stdout.trim() === 't');
  });
  if (!missing.length) return { ok: true, server: true, missing: [], problems: [] };
  return {
    ok: false,
    server: true,
    missing,
    problems: [
      `The scratch server on ${where} is up but ${missing.length} required database(s) are missing or empty: ${missing.join(', ')}.`,
      OWN_SERVER ? 'Build what is missing (several minutes):   node scripts/dev/scratch-server.cjs ensure' : 'Rebuild them with:   PGPORT=<port> node scripts/dev/security-scratch.cjs build',
    ],
  };
}

// prints the problems and returns false; a caller decides whether to stop
function requireScratch(label, databases) {
  const p = preflight(databases);
  if (p.ok) return true;
  console.error(`PREFLIGHT FAILED (${label}): the database-backed tests cannot run.`);
  p.problems.forEach((l) => console.error('  ' + l));
  return false;
}

module.exports = { REQUIRED, envFor, preflight, requireScratch, PG: sec.PG, OWN_SERVER };

if (require.main === module) {
  if (process.argv[2] !== 'check') {
    console.error('usage: node scripts/dev/scratch-env.cjs check');
    process.exit(2);
  }
  const p = preflight();
  if (p.ok) console.log(`scratch databases ready on ${sec.PG.host}:${sec.PG.port}: ${REQUIRED.join(', ')}`);
  else p.problems.forEach((l) => console.error(l));
  process.exit(p.ok ? 0 : 1);
}
