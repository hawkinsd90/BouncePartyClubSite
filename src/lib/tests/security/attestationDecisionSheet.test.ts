// S2 attestation decision sheet (audit/step4/s2-attestation-decision-sheet.html), its CSV and the review package: structural and behavioural checks.
// PURE: committed files only; no database, no network, no browser. The sheet's logic block (SHA-256 and the decision-record builder) is evaluated in Node and compared with node:crypto.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/security/attestationDecisionSheet.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { exit(code: number): never };
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseCsv } = require('../../../../scripts/dev/local-executor/build-allowlist.cjs');

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
const html: string = fs.readFileSync(path.join(S4, 's2-attestation-decision-sheet.html'), 'utf8');
const pkg: string = fs.readFileSync(path.join(S4, 's2-attestation-decision-package.md'), 'utf8');
const csvRows: any[] = parseCsv(fs.readFileSync(path.join(S4, 's2-attestation-decision-sheet.csv'), 'utf8'));
const manifest: any[] = parseCsv(fs.readFileSync(path.join(S4, 's2-reconciliation-manifest.csv'), 'utf8'));
const results = JSON.parse(fs.readFileSync(path.join(S4, 's2-attestation-readonly-results.json'), 'utf8'));
const checksSql: string = fs.readFileSync(path.join(S4, 's2-attestation-readonly-checks.sql'), 'utf8');

// ---- extract the two scripts ----
const logicM = html.match(/<script id="logic">([\s\S]*?)<\/script>/);
const wiringM = html.match(/<script id="wiring">([\s\S]*?)<\/script>/);
ok('the sheet has a separate logic script and a wiring script', !!logicM && !!wiringM);
const logic = (logicM as any)[1];
const wiring = (wiringM as any)[1];
const lib = new Function(logic + '\nreturn { sha256: sha256, buildRecord: buildRecord };')();
const dataM = wiring.match(/var DATA = (\[[\s\S]*?\]);\nvar GROUPS/);
ok('the sheet embeds a DATA array', !!dataM);
const DATA: any[] = JSON.parse((dataM as any)[1]);

// ---- SHA-256 implementation ----
const samples = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(200), 'D01 20251209133113 B19 ATTEST\nD02 20260120203953 B19 REJECT', 'é☃ unicode', '\n'.repeat(130)];
for (const s of samples) ok(`sha256 matches node:crypto for a ${s.length}-character input`, lib.sha256(s) === crypto.createHash('sha256').update(s, 'utf8').digest('hex'));

// ---- data completeness and consistency with the manifest and the CSV ----
const att = manifest.filter((r) => /^blocked until the owner signs/.test(r.readiness));
ok('the manifest still lists exactly 44 attestations awaiting signature', att.length === 44);
ok('the sheet has 44 rows with unique ids D01..D44 and unique versions', DATA.length === 44 && new Set(DATA.map((r) => r.id)).size === 44 && new Set(DATA.map((r) => r.version)).size === 44 && DATA.every((r, i) => r.id === 'D' + String(i + 1).padStart(2, '0')));
ok('the sheet rows are exactly the manifest attestations, with the manifest batch', DATA.every((r) => { const m = att.find((a) => a.version === r.version); return !!m && m.batch === r.batch; }));
ok('the CSV matches the sheet (ids, versions, batches, recommendations)', csvRows.length === 44 && csvRows.every((c, i) => c.id === DATA[i].id && c.version === DATA[i].version && c.batch === DATA[i].batch && c.recommended_decision === DATA[i].rec));
ok('the CSV owner_decision column is empty for every row (no decision is pre-recorded)', csvRows.every((c) => (c.owner_decision || '') === ''));
const REC = ['ATTEST', 'REJECT', 'NEEDS OWNER REVIEW'];
const need = ['name', 'expected', 'observed', 'strength', 'rerun', 'rec', 'conf', 'why', 'unknown', 'chk'];
ok('every row shows the required evidence fields (name, expected, observed, strength, rerun risk, recommendation, confidence, reason, unknown, check)', DATA.every((r) => need.every((k) => typeof r[k] === 'string' && r[k].length >= 2)) && DATA.every((r) => r.expected.length > 20 && r.observed.length > 20 && r.why.length > 20));
ok('every recommendation is ATTEST, REJECT or NEEDS OWNER REVIEW', DATA.every((r) => REC.includes(r.rec)));
const count = (k: string) => DATA.filter((r) => r.rec === k).length;
ok('recommendation counts are 42 ATTEST, 1 NEEDS OWNER REVIEW, 1 REJECT', count('ATTEST') === 42 && count('NEEDS OWNER REVIEW') === 1 && count('REJECT') === 1);
ok('D10 is ATTEST (owner decision: current $3.00 configuration authoritative); D20 needs owner review; D21 is rejected until the credential is fixed', DATA.find((r) => r.id === 'D10').rec === 'ATTEST' && /OWNER DECISION/.test(DATA.find((r) => r.id === 'D10').observed) && /never be executed|never run/i.test(DATA.find((r) => r.id === 'D10').why + DATA.find((r) => r.id === 'D10').unknown) && DATA.find((r) => r.id === 'D20').rec === 'NEEDS OWNER REVIEW' && DATA.find((r) => r.id === 'D21').rec === 'REJECT');
ok('D18 and D19 are recommended ATTEST (D19 with medium confidence)', DATA.find((r) => r.id === 'D18').rec === 'ATTEST' && DATA.find((r) => r.id === 'D19').rec === 'ATTEST' && DATA.find((r) => r.id === 'D19').conf === 'medium');
ok('every item that is not ATTEST has a non-trivial statement of what remains unknown', DATA.filter((r) => r.rec !== 'ATTEST').every((r) => r.unknown.length > 40));

// ---- nothing is pre-selected ----
ok('no input is pre-checked in the markup or in the generated radio markup', !/\bchecked\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')) && !/<input[^>]*type="radio"[^>]*checked/.test(wiring));
ok('the only code that selects a radio is the confirmed, owner-initiated "select ATTEST" button', (wiring.match(/\.checked = true/g) || []).length === 1 && /confirm\(/.test(wiring));
ok('the ATTEST/REJECT controls are radio inputs named by decision id', /type="radio" name="' \+ r\.id \+ '" value="ATTEST"/.test(wiring) && /type="radio" name="' \+ r\.id \+ '" value="REJECT"/.test(wiring));

// ---- record builder ----
const none: any = {};
const noName = lib.buildRecord(DATA, none, '  ', '2026-10-20T00:00:00.000Z');
ok('a record is refused without a name', noName.error === 'name');
const part: any = {};
DATA.slice(0, 43).forEach((r) => { part[r.id] = 'ATTEST'; });
const missing = lib.buildRecord(DATA, part, 'Owner', '2026-10-20T00:00:00.000Z');
ok('a record is refused while any version is undecided and names the missing id', missing.error === 'undecided' && missing.missing.length === 1 && missing.missing[0] === 'D44');
const bad: any = {};
DATA.forEach((r) => { bad[r.id] = 'MAYBE'; });
ok('values other than ATTEST/REJECT count as undecided', lib.buildRecord(DATA, bad, 'Owner', 'x').error === 'undecided');
const all: any = {};
DATA.forEach((r) => { all[r.id] = 'ATTEST'; });
const rec1 = lib.buildRecord(DATA, all, 'Owner', '2026-10-20T00:00:00.000Z');
ok('a complete record has 44 identified lines "ID version batch DECISION" in sheet order', rec1.body.split('\n').length === 44 && rec1.body.split('\n').every((l: string, i: number) => l === `${DATA[i].id} ${DATA[i].version} ${DATA[i].batch} ATTEST`));
ok('the record SHA-256 equals node:crypto over the decision list', rec1.hash === crypto.createHash('sha256').update(rec1.body, 'utf8').digest('hex'));
ok('the record text carries the attestor, UTC time, counts, hash and the list', /Attestor: Owner/.test(rec1.text) && /UTC: 2026-10-20T00:00:00.000Z/.test(rec1.text) && /Attest: 44 Reject: 0/.test(rec1.text) && rec1.text.includes('SHA-256 of the list below: ' + rec1.hash) && rec1.text.endsWith(rec1.body));
const mix: any = {};
DATA.forEach((r) => { mix[r.id] = r.rec === 'ATTEST' ? 'ATTEST' : 'REJECT'; });
const rec2 = lib.buildRecord(DATA, mix, 'Owner', 'x');
ok('counts follow the choices (42 attest, 2 reject)', rec2.attest === 42 && rec2.reject === 2 && /Attest: 42 Reject: 2/.test(rec2.text));
ok('"differs from recommendation" ignores NEEDS OWNER REVIEW items and flags a changed row', /Differs from recommendation \(excluding NEEDS OWNER REVIEW items\): none/.test(rec2.text));
const flip: any = Object.assign({}, mix);
flip['D01'] = 'REJECT';
ok('a row that differs from its recommendation is named in the record', /Differs from recommendation[^\n]*: D01/.test(lib.buildRecord(DATA, flip, 'Owner', 'x').text));
const swap: any = Object.assign({}, mix);
swap['D02'] = 'REJECT';
ok('changing one decision changes the hash', lib.buildRecord(DATA, swap, 'Owner', 'x').hash !== rec2.hash);

// ---- copy and build wiring ----
ok('the copy button uses the clipboard command and reports failure', /execCommand\('copy'\)/.test(wiring) && /copy it manually/.test(wiring));
ok('the build button reports a missing name and undecided ids', /Type your name first/.test(wiring) && /Undecided: /.test(wiring));
ok('the page sends nothing anywhere (no fetch, XHR, form action or external URL)', !/fetch\(|XMLHttpRequest|<form|(src|href|action)=["']https?:/i.test(html));

// ---- package and results ----
let allHeadings = true;
for (let i = 1; i <= 44; i++) if (!new RegExp('#### D' + String(i).padStart(2, '0') + ' `\\d{14}`').test(pkg)) allHeadings = false;
ok('the package has an evidence section for each of D01..D44', allHeadings);
ok('the package states that recommendations are not signatures and that nothing is recorded', /RECOMMENDATIONS ARE NOT SIGNATURES/.test(pkg) && /NOTHING IS ATTESTED/.test(pkg));
ok('the package leads with the demo-administrator, total-spent and travel-rate findings', /D21: a MASTER login/.test(pkg) && /D20: customer totals are stale/.test(pkg) && /D10 is decided: ATTEST/.test(pkg));
ok('the package explains the four named cases D18..D21', ['D18', 'D19', 'D20', 'D21'].every((d) => new RegExp('### ' + d + ':').test(pkg)));
ok('the recorded ledger in the results is the Wave 2 closing value', results.ledger.rows === 223 && results.ledger.sha256 === 'e8f53b1e951463a8731ac8fdb7497b689c4677da437cad02ff7b29b1b493bbf4');
ok('the SQL file is read-only: no INSERT, UPDATE, DELETE, DDL or GRANT statement', !/^\s*(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b/im.test(checksSql.replace(/--.*$/gm, '')));
ok('no secret or published password value appears in the sheet, package or results', ![html, pkg, JSON.stringify(results)].some((t) => /admin123|sk_(live|test)_|eyJ[A-Za-z0-9_-]{20}/.test(t)));


// ---- revised owner decisions of 2026-10-20: SEC-005 plan, travel-fee review, D20 correction ----
const sec = fs.readFileSync(path.join(S4, 'sec005-development-remediation-plan.md'), 'utf8');
const trav = fs.readFileSync(path.join(S4, 'travel-fee-historical-preservation-review.md'), 'utf8');
const d20plan = fs.readFileSync(path.join(S4, 'd20-contact-statistics-correction-plan.md'), 'utf8');
const d20sql = fs.readFileSync(path.join(S4, 'd20-contact-statistics-correction.sql'), 'utf8');
const d20code = d20sql.replace(/--.*$/gm, '');
ok('SEC-005 plan: nothing changed, never signs in with the published password, does not depend on the website reset', /NOTHING WAS CHANGED/.test(sec) && /never used to sign in/.test(sec) && /depends on the public reset workflow/.test(sec));
ok('SEC-005 plan: requires proof of alternate master access first, disables rather than deletes, handles sessions and rotation before unban', /Prove alternate access/.test(sec) && /\*\*do not delete; disable\.\*\*/.test(sec) && /Sessions and tokens/.test(sec) && /rotate before any unban/.test(sec));
ok('SEC-005 plan: the second account is not treated as harmless because it has no role, and the reset defect is logged as open', /not assume that having no role makes it harmless|having no role makes it harmless/.test(sec) && /defect \(open; not fixed/.test(sec));
ok('travel review: stored fee and snapshot columns on all orders, no retroactive change today, one latent gap with its code path, no changes made', /171 Development orders/.test(trav) && /45 of 45/.test(trav) && /latent retroactive-pricing gap/.test(trav) && /shouldReuseSavedTravel/.test(trav) && /no code or schema was changed/.test(trav));
ok('D20 plan: root cause is the second trigger; correction is limited to contacts statistics; rollback and authorization statement present', /update_contact_stats_trigger/.test(d20plan) && /57/.test(d20plan) && /Rollback/.test(d20plan) && /D20 PART 1/.test(d20plan));
ok('D20 SQL: guards the 57-contact target, updates only public.contacts, contains no DDL and never writes orders, payments, invoices or order items', /<> 57/.test(d20code) && /UPDATE public\.contacts/.test(d20code) && !/\b(update|insert|delete)\s+(into\s+)?public\.(orders|payments|invoices|order_items|order_custom_fees|order_discounts)\b/i.test(d20code) && !/\b(alter|create\s+(table|trigger|function)|drop)\b/i.test(d20code.replace(/CREATE TEMP TABLE d20_target ON COMMIT DROP/, '')));
ok('the correction is marked prepared and not authorized', /NOT AUTHORIZED, NOT EXECUTED/.test(d20sql) && /PLAN FOR SEPARATE AUTHORIZATION/.test(d20plan));

console.log(`attestation decision sheet: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
