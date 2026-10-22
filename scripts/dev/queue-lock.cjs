'use strict';
// A queue for work that must not overlap between sessions: the caller waits for its turn instead of failing or colliding.
//
//   const waited = await require('./queue-lock.cjs').acquire('db-tests', 'the database tests of another run');
//
// Why: several sessions share one machine and one scratch PostgreSQL. Database-backed tests create and drop databases with FIXED names
// (devrefresh_<name>_dev, ...), so two runs at the same moment delete each other's databases and fail for no reason of their own.
// A lock file in the temp folder holds the pid of the run whose turn it is; a lock whose process is gone is stale and is taken over.
// The lock is released when the process exits. QUEUE_WAIT_MIN (default 120) bounds the wait; QUEUE_POLL_MS sets how often to look.
// Returns true when it had to wait (the caller should then look at the world again: others have usually changed the cache meanwhile).
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquire(name, label = 'another run') {
  const file = path.join(os.tmpdir(), `bpc-${name}.lock`);
  const holder = () => {
    let other = 0;
    try { other = Number(fs.readFileSync(file, 'utf8')); } catch { return 0; }
    if (!other || other === process.pid) return 0;
    try { process.kill(other, 0); return other; } catch { return 0; } // not running: a stale lock
  };
  const start = Date.now();
  const maxMs = (Number(process.env.QUEUE_WAIT_MIN) || 120) * 60000;
  let told = 0;
  for (;;) {
    try { fs.writeFileSync(file, String(process.pid), { flag: 'wx' }); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const other = holder();
      if (!other) { try { fs.unlinkSync(file); } catch { /* someone else took it */ } await sleep(200 + Math.random() * 400); continue; }
      if (Date.now() - start > maxMs) { console.error(`Gave up waiting for ${label} (pid ${other}); QUEUE_WAIT_MIN bounds the wait.`); process.exit(2); }
      if (!told || Date.now() - told > 300000) { console.log(`waiting for ${label} (pid ${other}): runs of this kind take turns because they share the scratch databases`); told = Date.now(); }
      await sleep(Number(process.env.QUEUE_POLL_MS) || 10000);
    }
  }
  process.on('exit', () => { try { if (Number(fs.readFileSync(file, 'utf8')) === process.pid) fs.unlinkSync(file); } catch { /* gone */ } });
  return Date.now() - start > 3000;
}

module.exports = { acquire };
