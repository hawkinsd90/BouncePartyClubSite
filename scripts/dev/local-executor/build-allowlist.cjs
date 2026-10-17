#!/usr/bin/env node
'use strict';
// Builds the reviewable allowlist document for the LOCAL scratch executor (Stage E2G). Offline: reads git objects and local files only, writes one JSON file.
// The document binds a list of migration versions to ONE git commit and to the SHA-256 of each file's LF-normalised text, plus the expected base history (count, hash of the sorted versions, latest).
//
// Usage (Production 58-version candidate from the E2C manifest):
//   node build-allowlist.cjs --repo-root DIR --commit FULLSHA --manifest-csv e2c-proposed-execution-manifest.csv --base-history prod_catalog_history.json --withdrawn-index withdrawn-index.json --out allowlist.json
// Usage (generic items, used by the tests): --items-json items.json instead of --manifest-csv
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const ex = require('./local-migration-executor.cjs');

const HISTORY_ONLY_RULES = {
  '20260715221828': { basis: "net-zero pair: policy 'Anon can insert portal shortlinks' is absent on public.invoice_links; the SQL is never executed", predicate_sql: "select not exists (select 1 from pg_policy where polrelid = 'public.invoice_links'::regclass and polname = 'Anon can insert portal shortlinks')" },
  '20260716104333': { basis: "net-zero pair: policy 'Anon can insert portal shortlinks' is absent on public.invoice_links; the SQL is never executed", predicate_sql: "select not exists (select 1 from pg_policy where polrelid = 'public.invoice_links'::regclass and polname = 'Anon can insert portal shortlinks')" },
  '20261010110000': { basis: 'orders.customer_approved_at already exists; the guarded ADD COLUMN would change nothing', predicate_sql: "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'customer_approved_at')" },
  '20260716151530': { basis: 'superseded by 20260716152447', record_after: ['20260716152447'] },
  '20260716152823': { basis: 'superseded by 20260717012112 and 20260717110808', record_after: ['20260717012112', '20260717110808'] },
  '20260716173644': { basis: 'superseded by 20260820165646', record_after: ['20260820165646'] },
  '20260717111737': { basis: 'superseded by 20260717111803', record_after: ['20260717111803'] },
  '20260717113131': { basis: 'superseded by 20260717115647', record_after: ['20260717115647'] },
  '20260814114825': { basis: 'superseded by 20260814120100', record_after: ['20260814120100'] },
};

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

function build(p) {
  const git = (args) => cp.execFileSync('git', ['-C', p.repoRoot, ...args], { maxBuffer: 256 * 1024 * 1024 });
  const commit = git(['rev-parse', p.commit + '^{commit}']).toString().trim();
  const migDir = p.migrationsDir || 'supabase/migrations';
  let items;
  if (p.itemsJson) items = JSON.parse(fs.readFileSync(p.itemsJson, 'utf8'));
  else {
    const rows = parseCsv(fs.readFileSync(p.manifestCsv, 'utf8'));
    const execSet = new Set(rows.filter((r) => r.proposed_action === 'execute').map((r) => r.version));
    items = rows.map((r) => {
      const isExec = r.proposed_action === 'execute';
      const rule = HISTORY_ONLY_RULES[r.version];
      if (!isExec && !rule) throw new Error(`no history-only rule for ${r.version}`);
      return { version: r.version, file: r.filename, kind: isExec ? 'execute' : 'history-only', requires: isExec ? (r.depends_on_selected_versions || '').split(/[,;]\s*/).filter((v) => /^\d{14}$/.test(v) && execSet.has(v) && v < r.version) : [], ...(isExec ? {} : rule) };
    });
  }
  const cw = p.criticalWindow || null;
  const extraDeps = p.dependenciesJson ? JSON.parse(fs.readFileSync(p.dependenciesJson, 'utf8')).requires : {};
  const out = items.map((it, i) => {
    const o = { order: i + 1, version: it.version, file: it.file, name: it.file.slice(15).replace(/\.sql(\.sql)?$/, ''), kind: it.kind, requires: [...new Set([...(it.requires || []), ...(extraDeps[it.version] || [])])].sort() };
    if (it.kind === 'execute') {
      o.sha256_lf = ex.sha256(ex.normalizeLF(git(['show', `${commit}:${migDir}/${it.file}`])));
      o.phase = cw ? (it.version < cw.first ? 'P2' : it.version <= cw.last ? 'P3' : 'P4') : 'P2';
    } else {
      o.phase = it.kind === 'attestation' ? 'attestation' : 'history-only'; o.basis = it.basis; for (const f of ['attested_by', 'attested_at', 'scope', 'not_proven']) if (it[f]) o[f] = it[f]; if (it.record_after) o.record_after = it.record_after; if (it.predicate_sql) o.predicate_sql = it.predicate_sql;
    }
    return o;
  });
  const hist = JSON.parse(fs.readFileSync(p.baseHistory, 'utf8')).map((r) => (typeof r === 'string' ? r : r.version)).sort();
  const deny = p.withdrawnIndex ? JSON.parse(fs.readFileSync(p.withdrawnIndex, 'utf8')).withdrawn.map((w) => w.version) : ex.WITHDRAWN.slice();
  const doc = {
    schema: 'bpc-local-allowlist/1', environment: 'local-scratch', commit, migrations_dir: migDir, items: out, deny: [...new Set([...deny, ...ex.WITHDRAWN])].sort(),
    expected_base_history: { count: hist.length, versions_sha256: ex.sha256(Buffer.from(hist.join('\n'), 'utf8')), latest: hist[hist.length - 1] },
    critical_window: cw, note: 'Local scratch use only. Not an approval for any hosted environment.',
  };
  doc.document_sha256 = ex.documentHash(doc);
  return doc;
}

module.exports = { build, parseCsv, HISTORY_ONLY_RULES };

if (require.main === module) {
  const a = process.argv.slice(2), get = (n) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : undefined; };
  const doc = build({ repoRoot: path.resolve(get('repo-root') || '.'), commit: get('commit'), manifestCsv: get('manifest-csv'), itemsJson: get('items-json'), baseHistory: get('base-history'), withdrawnIndex: get('withdrawn-index'),
    dependenciesJson: get('dependencies-json'), criticalWindow: get('critical-first') ? { first: get('critical-first'), last: get('critical-last') } : null });
  fs.writeFileSync(get('out'), JSON.stringify(doc, null, 1) + '\n');
  console.log(JSON.stringify({ out: get('out'), commit: doc.commit, execute: doc.items.filter((i) => i.kind === 'execute').length, history_only: doc.items.filter((i) => i.kind === 'history-only').length, document_sha256: doc.document_sha256 }));
}
