// S2 consolidated execution package (AUTH-10) and the SG-2 preparation: structural and consistency checks on committed files.
// PURE: committed files only; no database, no network. Run: node node_modules/jiti/bin/jiti.js src/lib/tests/security/s2ConsolidatedPackage.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { exit(code: number): never };
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
const ROOT = path.join(__dirname, '..', '..', '..', '..');
const S4 = path.join(ROOT, 'audit', 'step4');
const read = (p: string) => fs.readFileSync(p, 'utf8');
const sha = (b: any) => crypto.createHash('sha256').update(b).digest('hex');
const lf = (s: string) => s.replace(/\r\n/g, '\n');
const shaf = (p: string) => sha(Buffer.from(lf(fs.readFileSync(p, 'utf8')), 'utf8')); // hashes are over LF text, so a CRLF checkout must not change them

const PK = path.join(S4, 's2-consolidated-package');
const pkg = JSON.parse(read(path.join(PK, 'package.json')));
const record = read(path.join(S4, 's2-attestation-decision-record.txt'));
const V = require('../../../../scripts/dev/validate-attestation-decisions.cjs');
const sheet = read(path.join(S4, 's2-attestation-decision-sheet.html'));
const rows = JSON.parse(sheet.match(/^var DATA = (\[.*\]);$/m)![1]);
const auth = read(path.join(S4, 's2-consolidated-authorization.md'));
const apprText = lf(read(path.join(S4, 's2-auth10-approval-text.txt'))).replace(/\n+$/, '');

// decision record
const v = V.validate(record, rows);
ok('the committed decision record validates: 44 ATTEST, 0 REJECT, 11 attestation batches, B31/B33/B40 unblocked', v.ok && v.attest === 44 && v.reject === 0 && v.plan.length === 11 && v.history_only_unblocked.join() === 'B31,B33,B40');
ok('the package binds the record hash and the record file hash', pkg.decision_record_sha256 === v.hash && pkg.evidence_sha256 === shaf(path.join(S4, 's2-attestation-decision-record.txt')));
ok('the attestor line names the owner and records that the decisions came by chat message', /Owner of Bounce Party Club LLC/.test(record) && /owner chat message/.test(record) && pkg.attestor.includes('owner chat message'));
ok('the owner-supplied qualified hashes equal the recomputed ones', ['D20:28d222463b445da011a4828029f10187ba23d152f1bcbf16d740be387edb07ec', 'D21:bf040e876d534c49ed2828cc9d63c5bca2520cc49b79234eb7a896304ce4850f'].every((x) => { const [id, h] = x.split(':'); const q = JSON.parse(read(path.join(S4, 's2-qualified-attestations.json')))[id]; return sha(q.scope + '\n' + q.not_proven) === h && record.includes(id + ' QUALIFIED-SCOPE-SHA256 ' + h); }));

// approval and batches
ok('approval text hash equals the package value and is in every script', sha(apprText) === pkg.approval_sha256 && pkg.batches.every((b: any) => lf(read(path.join(PK, b.file))).startsWith('-- BPC-DEV-RECONCILIATION script for batch ' + b.batch) && read(path.join(PK, b.file)).split('\n')[0].includes(pkg.approval_sha256)));
ok('14 batches, 80 new rows, counts chain from 223 to 303', pkg.batches.length === 14 && pkg.total_new_rows === 80 && pkg.batches[0].start_count === 223 && pkg.batches[13].end_count === 303 && pkg.batches.every((b: any, i: number) => b.end_count - b.start_count === b.versions.length && (i === 0 || b.start_count === pkg.batches[i - 1].end_count)));
ok('44 attestation versions and 36 history-only versions, no duplicates', pkg.batches.filter((b: any) => b.kind === 'attestation').reduce((n: number, b: any) => n + b.versions.length, 0) === 44 && pkg.batches.filter((b: any) => b.kind === 'history-only').reduce((n: number, b: any) => n + b.versions.length, 0) === 36 && new Set(pkg.batches.flatMap((b: any) => b.versions)).size === 80);
ok('batch order: B21 before B31 and B33, B18 before B31, B31 and B33 before B40', ['B18', 'B21'].every((x) => pkg.order.indexOf(x) < pkg.order.indexOf('B31')) && pkg.order.indexOf('B21') < pkg.order.indexOf('B33') && pkg.order.indexOf('B31') < pkg.order.indexOf('B40') && pkg.order.indexOf('B33') < pkg.order.indexOf('B40'));
ok('every filled script and reversal script hash equals its file', pkg.batches.every((b: any) => shaf(path.join(PK, b.file)) === b.filled_sha256 && shaf(path.join(PK, b.batch + '_reversal.sql')) === b.reversal_sha256));
const all = pkg.batches.map((b: any) => read(path.join(PK, b.file))).join('\n');
ok('no unfilled placeholder in any script', !/\{\{/.test(all));
ok('every inserted marker says NOT EXECUTED; none says executed', (all.match(/NOT EXECUTED; batch=/g) || []).length === 80 && !/BPC-DEV-RECONCILIATION executed/.test(all));
ok('no script runs historical SQL (no verbatim migration section, no bpcsql block)', !/bpcsql/.test(all) && !/follows verbatim/.test(all));
const body = all.split('\n').filter((l: string) => !/^\s*--/.test(l) && !/INSERT INTO supabase_migrations/.test(l) && !/IF (NOT )?COALESCE|IF EXISTS|IF \(SELECT/.test(l));
ok('statements outside the guarded IF/INSERT lines are only SET LOCAL, the advisory lock and the DO block frame', body.every((l: string) => /^\s*$/.test(l) || /^SET LOCAL /.test(l) || /^SELECT pg_advisory_xact_lock/.test(l) || /^DO \$bpc\$$/.test(l) || /^BEGIN$/.test(l) || /^END \$bpc\$;$/.test(l)));

// qualified scopes and special conditions in the markers
const b21 = read(path.join(PK, 'B21_filled.sql'));
const b22 = read(path.join(PK, 'B22_filled.sql'));
const q = JSON.parse(read(path.join(S4, 's2-qualified-attestations.json')));
const esc = (s: string) => s.replace(/'/g, "''");
ok('B21 carries the exact D20 qualified scope and not-proven text', b21.includes('scope=' + esc(q.D20.scope) + '; not_proven=' + esc(q.D20.not_proven)));
ok('B22 carries the exact D21 qualified scope and not-proven text', b22.includes('scope=' + esc(q.D21.scope) + '; not_proven=' + esc(q.D21.not_proven)));
ok('the D20 marker never uses the ordinary wording', !/reflects all intended outcomes/.test(b21));
ok('D10, D19, D40, D44 and D18 conditions are in their markers', /3\.00 dollars per mile rate is authoritative/.test(all) && /22 orders created after the migration with NULL selections stay unchanged/.test(all) && /does not certify the permissive INSERT and UPDATE policies/.test(all) && /seven newer invoice links are not relabelled/.test(all) && /test_message template must not be recreated/.test(all));

// rule overrides
const ovr = JSON.parse(read(path.join(S4, 's2-attestation-rule-overrides.json')));
const ovrKeys = Object.keys(ovr).filter((k) => !k.startsWith('_'));
ok('six rule overrides for D08, D10, D19, D25, D43, D44 and each is reflected in the package', ovrKeys.length === 6 && ['D08', 'D10', 'D19', 'D25', 'D43', 'D44'].every((id) => ovrKeys.some((k) => ovr[k].id === id)) && ovrKeys.every((k) => pkg.rule_overrides[k] && pkg.rule_overrides[k].sql_sha256 === sha(ovr[k].sql)));
ok('the D10 override asserts the owner decision (300 cents per mile), not the obsolete 500', /per_mile_after_base_cents IS DISTINCT FROM 300/.test(ovr['20251002180149'].sql) && !/500/.test(ovr['20251002180149'].sql));

// prediction and documentation
const pred = read(path.join(PK, 'predict_ledger.sql'));
ok('the prediction query covers 80 rows in 14 ordinals and starts from the real ledger', (pred.match(/^\(\d+,'\d{14}'/gm) || []).length === 80 && /generate_series\(0,14\)/.test(pred) && /FROM supabase_migrations\.schema_migrations/.test(pred));
ok('the authorization document states the statement, hashes, 223 to 303 and the end SHA', auth.includes(apprText) && auth.includes(pkg.approval_sha256) && auth.includes('b4f1f35ef890f200286199c84d0b3b76659453ba11ed20cac980b4bf3f828176') && auth.includes('e8f53b1e951463a8731ac8fdb7497b689c4677da437cad02ff7b29b1b493bbf4') && pkg.batches.every((b: any) => auth.includes(b.filled_sha256) && auth.includes(b.reversal_sha256)));
ok('the authorization document excludes historical SQL, D20 repair, Auth, push and Production', /Running any historical migration SQL/.test(auth) && /D20 durable correction \(S12b\)/.test(auth) && /Git push; Production/.test(auth));

// SG-2 preparation
const sg = JSON.parse(read(path.join(S4, 'sg2-package', 'package.json')));
const sgDoc = read(path.join(S4, 'sg2-authorization-package.md'));
ok('SG-2: B23 and B24 start from the post-S2 ledger count 303 and end at 305', sg.batches.length === 2 && sg.batches[0].start_count === 303 && sg.batches[1].end_count === 305);
ok('SG-2: 21 functions (11 new), explicit verify_jwt for each, hashes present', sg.functions.length === 21 && sg.functions.filter((f: any) => f.new_function).length === 11 && sg.functions.every((f: any) => /^(true|false)$/.test(f.explicit_verify_jwt_at_deploy) && /^[0-9a-f]{64}$/.test(f.bundle_sha256)));
ok('SG-2: the only function needing a D-JWT-1 owner release is upload-physical-waiver', sg.functions.filter((f: any) => /D-JWT-1/.test(f.owner_release)).map((f: any) => f.function).join() === 'upload-physical-waiver');
ok('SG-2: canary hash equals the committed canary file and the document lists the order S3, S4, S4b', sg.canary_sha256_lf === sha(Buffer.from(lf(read(path.join(S4, 'g16-storage-canary.sql'))))) && /## 1\. S3/.test(sgDoc) && /## 2\. S4/.test(sgDoc) && /## 3\. S4b/.test(sgDoc));
ok('SG-2 scripts hashes equal their files', sg.batches.every((b: any) => shaf(path.join(S4, 'sg2-package', b.batch + '_filled.sql')) === b.filled_sha256));

// SG-2 release review: the deployable bundles still hash to the package, imports resolve and verify_jwt matches config.toml
const FDIR = path.join(ROOT, 'supabase', 'functions');
const filesOf = (d: string): string[] => {
  const out: string[] = [];
  const walk = (p: string) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, e.name); if (e.isDirectory()) walk(q); else out.push(path.relative(FDIR, q)); } };
  walk(path.join(FDIR, d));
  return out;
};
const treeHash = (paths: string[]) => { const h = crypto.createHash('sha256'); for (const p of [...paths].sort()) { h.update(p.split(path.sep).join('/')); h.update(Buffer.from([0])); h.update(lf(fs.readFileSync(path.join(FDIR, p), 'utf8'))); h.update(Buffer.from([0])); } return h.digest('hex'); };
ok('SG-2: every function bundle hash and the shared tree hash still equal the package', sg.functions.every((f: any) => treeHash(filesOf(f.function)) === f.bundle_sha256) && treeHash(filesOf('_shared')) === sg.shared_sha256);
const cfgToml = read(path.join(ROOT, 'supabase', 'config.toml'));
ok('SG-2: the explicit verify_jwt of each of the 21 functions equals config.toml', sg.functions.every((f: any) => new RegExp('\\[functions\\.' + f.function + '\\]\\s*\\r?\\nverify_jwt\\s*=\\s*' + f.explicit_verify_jwt_at_deploy).test(cfgToml)));
ok('SG-2: relative imports of the 21 bundles resolve inside the function folder or _shared', sg.functions.every((f: any) => filesOf(f.function).filter((p) => p.endsWith('.ts')).every((p) => { const t = read(path.join(FDIR, p)); const re = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g; let m: any; while ((m = re.exec(t))) { const tgt = path.normalize(path.join(path.dirname(path.join(FDIR, p)), m[1])); if (!fs.existsSync(tgt)) return false; const top = path.relative(FDIR, tgt).split(path.sep)[0]; if (top !== f.function && top !== '_shared') return false; } return true; })));
ok('SG-2: the release review exists and records no blocker', /NO RELEASE BLOCKER FOUND/.test(read(path.join(S4, 'sg2-release-review.md'))));

// SG-3 preparation: the rendered scripts, the sealed package and the documented numbers agree
const sg3 = JSON.parse(read(path.join(S4, 'sg3-package', 'package.json')));
const sealed = JSON.parse(read(path.join(S4, 'executor', 'dev-package-oct-s3b.sealed.json')));
const sg3Doc = read(path.join(S4, 'sg3-authorization-package.md'));
ok('SG-3: 28 rendered scripts, in sealed order, each file equals its recorded hash', sg3.steps.length === 28 && sg3.steps.every((s: any, i: number) => s.version === sealed.items[i].version && s.step === i + 1 && shaf(path.join(S4, 'sg3-package', s.file)) === s.script_sha256));
ok('SG-3: the scripts are bound to the sealed package, base ledger 305 and the sealed fingerprints', sg3.package_sha256 === sealed.document_sha256 && sg3.base_ledger.count === 305 && sg3.start_fp_all === sealed.start_state.fp_all && sg3.steps.every((s: any, i: number) => s.pre_fp_all === sealed.items[i].pre_fp_all && s.post_fp_all === sealed.items[i].post_fp_all && s.source_sha256_lf === sealed.items[i].sha256_lf));
ok('SG-3: every rendered script carries the guards (pre and post blocks, containment, ledger count, rollback by exception)', sg3.steps.every((s: any) => { const t = read(path.join(S4, 'sg3-package', s.file)); return /BPC-EXECUTOR: wrong database/.test(t) && /\$bpcpost\$/.test(t) && /schema containment is not in force/.test(t) && new RegExp('unexpected ledger count after ' + s.version).test(t) && t.includes('(305 rows') === false; }));
ok('SG-3: expected ledger count after step N is 305 + N and 333 after step 28', sg3.steps.every((s: any) => s.ledger_after === 305 + s.step) && sg3.steps[27].ledger_after === 333);
ok('SG-3: the sealed package still has 23 withheld-gate and 5 step3b items and the deny list', sealed.items.filter((x: any) => x.class === 'withheld-gate').length === 23 && sealed.items.filter((x: any) => x.class === 'step3b').length === 5 && sealed.deny.includes('20251003170350'));
ok('SG-3: the document states the base identity, the 333 target, the channel choice and that nothing is authorized', sg3Doc.includes('76025b5b681008ec5b0239c57be1f54fd7bbed3a3f70fa1384698afcc6476c59') && sg3Doc.includes('333') && /Channel A/.test(sg3Doc) && /FINAL AUTH-12 STATEMENT HAS NOT BEEN SENT/.test(sg3Doc) && sg3Doc.includes(sealed.document_sha256));
// SG-3 final package: binding, S6 manifest, JWT matrix, backup script, step-12 evidence
const bind = JSON.parse(read(path.join(S4, 'sg3-package', 'binding.json')));
const s6 = JSON.parse(read(path.join(S4, 'sg3-package', 's6-functions.json')));
ok('SG-3 binding: template hash, sealed package, both manifests and the base ledger equal the files', bind.statement_template_sha256 === sha(bind.statement_template) && bind.sealed_package_sha256 === sealed.document_sha256 && bind.scripts_manifest_sha256 === shaf(path.join(S4, 'sg3-package', 'package.json')) && bind.s6_manifest_sha256 === shaf(path.join(S4, 'sg3-package', 's6-functions.json')) && bind.base_ledger.rows === 305 && bind.target_ledger_rows === 333);
ok('SG-3 binding: the template has exactly the two owner placeholders and quotes the manifest prefixes', (bind.statement_template.match(/\{[A-Z_]+\}/g) || []).join() === '{RESTORE_POINT_ID}' && bind.statement_template.includes(bind.sealed_package_sha256.slice(0, 8)) && bind.statement_template.includes(bind.scripts_manifest_sha256.slice(0, 8)) && bind.statement_template.includes(bind.s6_manifest_sha256.slice(0, 8)) && sg3Doc.includes(bind.statement_template) && sg3Doc.includes(bind.statement_template_sha256));
const flips = s6.functions.filter((f: any) => f.flip_false_to_true).map((f: any) => f.function).sort().join();
ok('SG-3 S6: 21 functions, exactly 9 false-to-true flips, none of the twilio, checkout-bridge or crash-report functions is true', s6.functions.length === 21 && flips === 'charge-deposit,create-admin-user,promote-media,record-cash-payment,record-check-payment,save-payment-method-from-session,send-invoice,stripe-charge,stripe-checkout' && ['twilio-webhook', 'twilio-status-callback', 'checkout-bridge', 'send-error-notification', 'stripe-webhook'].every((n) => s6.functions.find((f: any) => f.function === n).explicit_verify_jwt === 'false'));
ok('SG-3 S6: the config.toml value equals the explicit value for all 21 (fix-payment-method corrected to true)', s6.functions.filter((f: any) => f.config_verify_jwt !== f.explicit_verify_jwt).length === 0 && s6.functions.find((f: any) => f.function === 'fix-payment-method').config_verify_jwt === 'true' && s6.functions.every((f: any) => /^[0-9a-f]{64}$/.test(f.directory_sha256)));
ok('SG-3 S6: shared tree hash equals the SG-2 package value (shared helpers unchanged since SG-2)', s6.shared_sha256 === sg.shared_sha256);
const bk = read(path.join(ROOT, 'scripts', 'dev', 'sg3', 'sg3-backup.ps1'));
const bk0 = read(path.join(ROOT, 'scripts', 'dev', 'auth3', 'auth3-backup.ps1'));
ok('SG-3 backup script: expects the 305-row ledger and the SG-2 hash, refuses Production, keeps the no-plaintext design', bk.includes('72cafdaca438365b30b41db0e7269832cc6591837dc8ef5bb5c01c125e2dd008') && bk.includes('ledger|305|20260929161925|') && !bk.includes('ledger|58|') && /ProdRef/.test(bk) && /pg_dump\.exe.*\| \$g \$enc/.test(bk) && !/plaintext dump file/.test(bk));
ok('SG-3 backup script differs from the validated AUTH-3 script in at most 10 lines', lf(bk0).split('\n').filter((l: string, i: number) => l !== lf(bk).split('\n')[i]).length <= 10);
// step-12 evidence: re-derive from the sealed files that only step 12 executes DML on business rows
const dmlTop = (sqlText: string) => { const noc = sqlText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, ''); let out: string[] = []; let i = 0; const re = /\$[A-Za-z_]*\$/g; let m: any; let open: any = null; let cur = 0; const top: string[] = []; const doBlocks: string[] = []; while ((m = re.exec(noc))) { if (!open) { top.push(noc.slice(cur, m.index)); open = { tag: m[0], start: re.lastIndex, prefix: noc.slice(Math.max(0, m.index - 40), m.index) }; cur = m.index; } else if (m[0] === open.tag) { if (/\bDO\s*(LANGUAGE\s+\w+\s*)?$/i.test(open.prefix)) doBlocks.push(noc.slice(open.start, m.index)); open = null; cur = re.lastIndex; } } top.push(noc.slice(cur)); const stmts = [...top, ...doBlocks].join('\n').split('\n').filter((l) => /^\s*(update|insert\s+into|delete\s+from|truncate)\b/i.test(l)).map((l) => l.trim().toLowerCase()); return stmts; };
const dmlByStep = sealed.items.map((it: any) => ({ v: it.version, d: dmlTop(read(path.join(ROOT, 'supabase', 'migrations', it.file))) }));
const business = (l: string) => /(user_roles|orders|payments|customers|contacts|invoices|units|pricing_rules|admin_settings)\b/.test(l);
ok('SG-3 step-12 evidence: no business-row DML in steps 1-11 and 13-28, user_roles DML in step 12', dmlByStep.every((x: any) => (x.v === '20261016120000') === x.d.some(business)) && dmlByStep.filter((x: any) => x.d.length && x.v !== '20261016120000').every((x: any) => x.d.every((l: string) => /storage\.buckets/.test(l))));
ok('SG-3 doc: records the step-12 options and the owner selection of B, the two orphan rows, the fix-payment-method exposure, and that Twilio routing is unverified', /\*\*A\. Retain/.test(sg3Doc) && /\*\*B\. Use the fresh/.test(sg3Doc) && sg3Doc.includes('09a71dda-1e39-42a9-9e78-a606968c6557') && /no role or ownership check/.test(sg3Doc) && /Not verified, cannot be from here/.test(sg3Doc));

ok('SG-3 statement: Channel A, Option B, both stubs and exactly the two named secrets; the exclusions section agrees', /Channel A \(connector\)/.test(bind.statement_template) && /Option B/.test(bind.statement_template) && /fix-payment-method and backfill-payment-methods/.test(bind.statement_template) && /SITE_URL and RETURN_ORIGINS[^(]*\(no other secret\)/.test(bind.statement_template) && /authorizes setting exactly two Edge Function secrets/.test(sg3Doc) && !/Not authorized by this package\s+Setting any secret/.test(sg3Doc));
const sg2Ev = read(path.join(S4, 'sg2-execution-evidence.md'));
ok('SG-2 evidence: ledger 305 and fingerprint bucket digest recorded, canary success recorded, no Production', sg2Ev.includes('72cafdaca438365b30b41db0e7269832cc6591837dc8ef5bb5c01c125e2dd008') && sg2Ev.includes('0bc770f2c5bb329f618516250c0cf124') && /BPC-CANARY-OK/.test(sg2Ev) && /Production was not contacted/.test(sg2Ev));

console.log(`S2 consolidated package: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
