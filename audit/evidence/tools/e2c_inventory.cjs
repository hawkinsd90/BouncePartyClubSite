// Stage E2C: expected pending-set inventories for the proposed repository-identity changes (hypothetical file lists only).
// Reads the migration DIRECTORY LISTING and the Stage B captured histories; uses scripts/dev/migration-pending-set.cjs exactly as it is.
// It renames, deletes and writes nothing in the repository; no database is contacted. Output: JSON on stdout (and the scratch folder).
// Usage: node audit/evidence/tools/e2c_inventory.cjs
const fs = require('fs');
const path = require('path');
const calc = require('../../../scripts/dev/migration-pending-set.cjs');

const root = path.join(__dirname, '..', '..', '..');
const PROT = 'C:\\Users\\vikki\\migration-evidence\\stage-b-20261016';
const names = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((n) => n.endsWith('.sql'));
const hist = { prod: JSON.parse(fs.readFileSync(path.join(PROT, 'prod_catalog_history.json'), 'utf8')), dev: JSON.parse(fs.readFileSync(path.join(PROT, 'dev_catalog_history.json'), 'utf8')) };
const aliasesNow = JSON.parse(fs.readFileSync(path.join(root, 'audit', 'evidence', 'version-aliases.json'), 'utf8'));

const C41 = '20260305203528', C42 = '20260407203226', ALIAS = '20260814120000', REC = '20260814002658';
const drop = (list, v) => list.filter((n) => !n.startsWith(v + '_'));
const rename = (list) => list.map((n) => (n.startsWith(ALIAS + '_') ? REC + n.slice(ALIAS.length) : n));
const scenarios = {
  S0_current: [names, aliasesNow],
  S1_withdraw_case41: [drop(names, C41), aliasesNow],
  S2_withdraw_case42: [drop(names, C42), aliasesNow],
  S3_withdraw_41_and_42: [drop(drop(names, C41), C42), aliasesNow],
  S4_rename_alias_only: [rename(names), aliasesNow],
  S5_all_three: [rename(drop(drop(names, C41), C42)), aliasesNow],
};
// the alias document as it would have to look after S5 (aliases for the three resolved identities removed, 41/42 listed as withdrawn)
const aliasesAfter = { aliases: [], withdrawn: [...aliasesNow.withdrawn, { version: C41, note: 'withdrawn (D-3)' }, { version: C42, note: 'withdrawn (D-4)' }] };
scenarios.S5b_all_three_with_updated_alias_doc = [scenarios.S5_all_three[0], aliasesAfter];

const out = {};
for (const [name, [files, doc]] of Object.entries(scenarios)) {
  const local = calc.collectLocalVersions(files);
  out[name] = { local_files: local.versions.length, local_findings: local.findings.length };
  for (const env of ['prod', 'dev']) {
    const r = calc.calculateEnvironment(env, local.versions, hist[env], doc, null);
    out[name][env] = { recorded: r.recorded_count, pending: r.pending_count, recorded_without_local_file: r.recorded_without_local_file, findings: r.findings.map((f) => f.kind + (f.version ? ':' + f.version : '')), alias_annotations: r.alias_annotations.length };
    out[name][env + '_pending_versions'] = r.pending_versions;
  }
}
const base = out.S0_current;
for (const [name, r] of Object.entries(out)) {
  for (const env of ['prod', 'dev']) {
    const before = new Set(base[env + '_pending_versions']), after = new Set(r[env + '_pending_versions']);
    r[env].removed_from_pending = [...before].filter((v) => !after.has(v));
    r[env].added_to_pending = [...after].filter((v) => !before.has(v));
  }
}
const summary = {};
for (const [name, r] of Object.entries(out)) {
  summary[name] = { local_files: r.local_files, prod: { pending: r.prod.pending, recorded_without_local_file: r.prod.recorded_without_local_file.length, findings: r.prod.findings, removed: r.prod.removed_from_pending, added: r.prod.added_to_pending },
    dev: { pending: r.dev.pending, recorded_without_local_file: r.dev.recorded_without_local_file, findings: r.dev.findings, removed: r.dev.removed_from_pending, added: r.dev.added_to_pending } };
}
fs.mkdirSync('C:\\Users\\vikki\\migration-evidence\\e2c-scratch', { recursive: true });
fs.writeFileSync('C:\\Users\\vikki\\migration-evidence\\e2c-scratch\\e2c-inventory.json', JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
