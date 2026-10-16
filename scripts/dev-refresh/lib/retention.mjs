// Retention of the local run data. NOTHING is ever deleted automatically: the only deletion in this tool is executeCleanup(), which runs
// only from the `cleanup --execute` command with an exact approval phrase over an exact list. Backups are protected by default.
//
// What a run folder holds, and the default policy (days are counted from the run's creation, or from when it was applied):
//   manifest.json, report.md   audit trail, no customer data: never removed here
//   export/                    a copy of Production order data (customer names, phones, emails). Not needed once the run is applied, failed,
//                              restored or blocked, or when an unapplied preview has expired. Removable at once in those cases.
//   outputs/, dev-rows-to-replace/, after-*    Stripe-reference and customer-id reports and row hashes: removable after 30 days
//   backup/, pre-restore-*/    the restore points. Removed only with --include-backups, and never the backup of the most recent applied run
//                              (the one `restore` would use), nor of an interrupted run.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EXPORT_MAX_AGE_HOURS } from './config.mjs';

export const RETENTION = { reportDays: 30, backupDays: 30, failedBackupDays: 7 };
const RUNS_DIRNAME = path.join('.dev-refresh', 'runs');
const DAY = 86400000;

function sizeOf(p) {
  if (!fs.existsSync(p)) return 0;
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0);
}

export function runsRoot(root) {
  return path.resolve(root, RUNS_DIRNAME);
}

export function inventory(root, now = Date.now()) {
  const dir = runsRoot(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, 'manifest.json')))
    .sort()
    .map((id) => {
      const runDir = path.join(dir, id);
      const m = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
      const since = Date.parse(m.appliedAt || m.createdAt);
      const entries = fs.readdirSync(runDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      return {
        id,
        runDir,
        status: m.status,
        ageDays: (now - since) / DAY,
        ageHours: (now - Date.parse(m.createdAt)) / 3600000,
        folders: entries.map((name) => ({ name, path: path.join(runDir, name), bytes: sizeOf(path.join(runDir, name)) })),
      };
    });
}

const DONE = ['applied', 'applied-verification-failed', 'failed', 'restored', 'restore-verification-failed', 'blocked'];

export function planCleanup(root, { includeBackups = false, now = Date.now(), days = {} } = {}) {
  const policy = { ...RETENTION, ...days };
  const runs = inventory(root, now);
  const restorePoint = [...runs].reverse().find((r) => r.status === 'applied' || r.status === 'applied-verification-failed');
  const items = [];
  const kept = [];
  for (const r of runs) {
    for (const f of r.folders) {
      const add = (reason) => items.push({ id: r.id, category: f.name, path: f.path, bytes: f.bytes, reason });
      const keep = (reason) => kept.push({ id: r.id, category: f.name, bytes: f.bytes, reason });
      const interrupted = r.status === 'applying' || r.status === 'backing-up';
      if (f.name === 'export') {
        if (interrupted) keep('run was interrupted: may need recovery');
        else if (DONE.includes(r.status)) add(`run is ${r.status}: the Production copy is no longer needed`);
        else if (r.status === 'previewed' && r.ageHours > EXPORT_MAX_AGE_HOURS) add('unapplied preview has expired');
        else keep('preview can still be applied');
      } else if (f.name === 'backup' || f.name.startsWith('pre-restore-')) {
        if (interrupted) keep('run was interrupted: may need recovery');
        else if (!includeBackups) keep('backups are removed only with --include-backups');
        else if (r === restorePoint && f.name === 'backup') keep('restore point of the most recent applied run');
        else if (r.status === 'restored' && r.ageDays >= policy.failedBackupDays) add('run was restored; its backup has served');
        else if (r.status === 'failed' && r.ageDays >= policy.failedBackupDays) add('apply failed and rolled back; the backup is of an unchanged state');
        else if (r.ageDays >= policy.backupDays && r !== restorePoint) add(`older than ${policy.backupDays} days and superseded`);
        else keep(`younger than the retention period`);
      } else if (['outputs', 'dev-rows-to-replace', 'after-apply', 'after-failure', 'after-restore', 'drift-check'].includes(f.name)) {
        if (interrupted) keep('run was interrupted: may need recovery');
        else if (r === restorePoint && f.name === 'after-apply') keep('needed to detect changes made after the most recent refresh');
        else if (r.ageDays >= policy.reportDays && DONE.includes(r.status)) add(`older than ${policy.reportDays} days`);
        else keep('younger than the retention period');
      } else keep('not a category this tool removes');
    }
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify(items.map((i) => [i.id, i.category]))).digest('hex').slice(0, 8);
  return { items, kept, hash, totalBytes: items.reduce((n, i) => n + i.bytes, 0) };
}

export function cleanupPhrase(plan) {
  return `DELETE LOCAL REFRESH DATA ${plan.items.length} ITEMS ${plan.hash}`;
}

// The ONLY place this tool removes files.
export function executeCleanup(root, plan, confirm) {
  if (!plan.items.length) return [];
  if (confirm !== cleanupPhrase(plan)) throw new Error(`Approval phrase does not match. To delete exactly this list type:\n  ${cleanupPhrase(plan)}`);
  const base = runsRoot(root) + path.sep;
  // Validate EVERY path before deleting anything: a bad entry must not leave a half-done cleanup.
  for (const item of plan.items) {
    const p = path.resolve(item.path);
    if (!p.startsWith(base) || p === base) throw new Error(`Refusing to delete outside the run folders: ${p}`);
  }
  const removed = [];
  for (const item of plan.items) {
    fs.rmSync(path.resolve(item.path), { recursive: true, force: true });
    removed.push({ id: item.id, category: item.category, bytes: item.bytes });
  }
  const byRun = new Map();
  for (const r of removed) byRun.set(r.id, [...(byRun.get(r.id) || []), r]);
  for (const [id, list] of byRun) {
    const mp = path.join(runsRoot(root), id, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
    m.cleanup = [...(m.cleanup || []), { at: new Date().toISOString(), removed: list.map((x) => x.category) }];
    fs.writeFileSync(mp, JSON.stringify(m, null, 2));
  }
  return removed;
}
