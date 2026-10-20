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
ok('recommendation counts are 42 ATTEST, 2 NEEDS OWNER REVIEW, 0 REJECT', count('ATTEST') === 42 && count('NEEDS OWNER REVIEW') === 2 && count('REJECT') === 0);
ok('D10 is ATTEST (owner decision: current $3.00 configuration authoritative); D20 and D21 need owner review (D21 contained by the bans, with their expiry date recorded)', DATA.find((r) => r.id === 'D10').rec === 'ATTEST' && /OWNER DECISION/.test(DATA.find((r) => r.id === 'D10').observed) && /never be executed|never run/i.test(DATA.find((r) => r.id === 'D10').why + DATA.find((r) => r.id === 'D10').unknown) && DATA.find((r) => r.id === 'D20').rec === 'NEEDS OWNER REVIEW' && DATA.find((r) => r.id === 'D21').rec === 'NEEDS OWNER REVIEW' && /BANNED/.test(DATA.find((r) => r.id === 'D21').observed) && /2026-11-13/.test(DATA.find((r) => r.id === 'D21').observed));
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
ok('a complete record has 44 identified lines "ID version batch DECISION" in sheet order plus one qualified-scope hash line per attested D20/D21', rec1.body.split('\n').length === 46 && rec1.body.split('\n').slice(0, 44).every((l: string, i: number) => l === `${DATA[i].id} ${DATA[i].version} ${DATA[i].batch} ATTEST`));
const QW: any = JSON.parse(fs.readFileSync('audit/step4/s2-qualified-attestations.json', 'utf8'));
const d20 = DATA.find((r: any) => r.id === 'D20'); const d21 = DATA.find((r: any) => r.id === 'D21');
ok('D20 qualified scope states every required point and never the ordinary wording', /function exists/.test(d20.qual) && /historical SQL execution is not proven/.test(d20.qual) && /statistics are stale/.test(d20.qual) && /pending at stage S12b/.test(d20.qual) && /does not claim that current statistics are correct/.test(d20.qual) && !/reflects all intended outcomes/.test(d20.qual));
ok('D21 qualified scope states every required point', /account exists/.test(d21.qual) && /Both accounts that share the public password are currently banned/.test(d21.qual) && /Neither password has been rotated/.test(d21.qual) && /2026-11-13/.test(d21.qual) && /Credential remediation remains required/.test(d21.qual) && /No historical migration SQL will execute/.test(d21.qual));
ok('qualified texts contain no marker separator or placeholder characters', ['D20', 'D21'].every((k) => !/[;{}]/.test(QW[k].scope + QW[k].not_proven)));
ok('qualified hash in the sheet equals the hash of the JSON file text', d20.qual_sha256 === QW.D20.sha256 && d21.qual_sha256 === QW.D21.sha256 && QW.D20.sha256 === crypto.createHash('sha256').update(QW.D20.scope + '\n' + QW.D20.not_proven, 'utf8').digest('hex'));
const onlyD20: any = {}; DATA.forEach((r: any) => { onlyD20[r.id] = r.id === 'D21' ? 'REJECT' : 'ATTEST'; });
const recQ = lib.buildRecord(DATA, onlyD20, 'Owner', 'x');
ok('D20 and D21 decide independently and the attested qualified wording is hashed into the record', recQ.body.includes('D20 QUALIFIED-SCOPE-SHA256 ' + d20.qual_sha256) && !recQ.body.includes('D21 QUALIFIED-SCOPE-SHA256') && recQ.attest === 43 && recQ.reject === 1);
const V = require('../../../../scripts/dev/validate-attestation-decisions.cjs');
const vAll = V.validate(rec1.text, DATA);
ok('validator accepts a complete record, plans all 11 attestation batches and unblocks B31, B33 and B40', vAll.ok && vAll.plan.length === 11 && vAll.pending.length === 0 && vAll.history_only_unblocked.join() === 'B31,B33,B40' && vAll.plan.reduce((n: number, p: any) => n + p.versions.length, 0) === 44);
ok('validator rejects a tampered decision, a wrong hash and a missing qualified-scope line', !V.validate(rec1.text.replace('D01 20251209133113 B19 ATTEST', 'D01 20251209133113 B19 REJECT'), DATA).ok && !V.validate(rec1.text.replace(/SHA-256 of the list below: [0-9a-f]+/, 'SHA-256 of the list below: ' + '0'.repeat(64)), DATA).ok && !V.validate(rec1.text.split(String.fromCharCode(10)).filter((l: string) => !/^D20 QUALIFIED/.test(l)).join(String.fromCharCode(10)), DATA).ok);
const vQ = V.validate(recQ.text, DATA);
ok('with D21 rejected only B22 stays pending and everything else, B31, B33 and B40 proceed', vQ.ok && vQ.pending.length === 1 && vQ.pending[0].batch === 'B22' && vQ.history_only_waiting.length === 0);
const noD20: any = {}; DATA.forEach((r: any) => { noD20[r.id] = r.id === 'D20' ? 'REJECT' : 'ATTEST'; });
const vN = V.validate(lib.buildRecord(DATA, noD20, 'Owner', 'x').text, DATA);
ok('with D20 rejected B21 stays pending and B31, B33 and B40 wait on it', vN.ok && vN.pending.map((p: any) => p.batch).join() === 'B21' && vN.history_only_waiting.map((w: any) => w.batch).join() === 'B31,B33,B40');
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
ok('the package leads with the demo-administrator, total-spent and travel-rate findings', /D21: the MASTER login[^\n]*contained, not remediated/.test(pkg) && /D20: customer totals are stale/.test(pkg) && /D10 is decided: ATTEST/.test(pkg));
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
ok('SEC-005 plan: containment-compatible prerequisite (fresh Google sign-in, id and master role check, distinctness, dashboard access); an old session refresh does not count', /0\.1 Containment-compatible proof/.test(sec) && /permission denied for schema public/.test(sec) && /token refresh of an old session/.test(sec) && /An existing browser session does not count/.test(sec) && /Supabase dashboard\*\*/.test(sec));
ok('SEC-005 plan: no hand-written writes to managed Auth tables; the ban is a dashboard action; the Admin UI test is not required now', /improvising writes against managed Auth tables/.test(sec) && /Do not delete rows from the managed `auth` tables by hand/.test(sec) && /expected to show 403 errors until access is restored/.test(sec));

// ---- durable D20 package (one mechanism), its rollback and fingerprint prediction ----
const dplan = fs.readFileSync(path.join(S4, 'd20-durable-correction-plan.md'), 'utf8');
const dsql = fs.readFileSync(path.join(S4, 'd20-durable-contact-statistics-correction.sql'), 'utf8');
const drb = fs.readFileSync(path.join(S4, 'd20-durable-rollback.sql'), 'utf8');
const dfp = fs.readFileSync(path.join(S4, 'd20-durable-fingerprint-prediction.sql'), 'utf8');
const dcode = dsql.replace(/--.*$/gm, '');
ok('durable D20: marked prepared and not authorized; placed after the sealed executor stages (S12b) because the executor refuses catalog drift', /NOT AUTHORIZED, NOT EXECUTED/.test(dsql) && /PREPARED FOR A SEPARATE, BOUNDED OWNER AUTHORIZATION/.test(dplan) && /S12b/.test(dplan) && /refuses|raises an exception for any step/.test(dplan));
ok('durable D20 SQL: preconditions by md5 of both deployed functions, a 57-contact guard, the obsolete trigger and function dropped, four statistics triggers asserted', /6725e093234175510332552d94f128ad/.test(dsql) && /274c74413a3123241fc9f669042b3e3d/.test(dsql) && /<> 57/.test(dsql) && /DROP TRIGGER update_contact_stats_trigger/.test(dsql) && /DROP FUNCTION public\.update_contact_stats\(\)/.test(dsql) && /<> 4 THEN RAISE EXCEPTION 'D20: unexpected statistics trigger set'/.test(dsql));
ok('durable D20 SQL: triggers cover orders insert/delete/inputs, custom fees, discounts and new contacts', /AFTER INSERT OR DELETE OR UPDATE OF status, customer_id, event_date, subtotal_cents/.test(dsql) && /ON public\.order_custom_fees/.test(dsql) && /ON public\.order_discounts/.test(dsql) && /AFTER INSERT ON public\.contacts/.test(dsql));
ok('durable D20 SQL: writes only public.contacts among data tables, no orders/payments/invoices statements, new functions revoked from PUBLIC, anon, authenticated and service_role', !/\b(update|insert\s+into|delete\s+from)\s+public\.(orders|payments|invoices|order_items|order_custom_fees|order_discounts|customers)\b/i.test(dcode) && /UPDATE public\.contacts/.test(dcode) && (dcode.match(/FROM PUBLIC, anon, authenticated, service_role;/g) || []).length === 4);
ok('durable D20 rollback: restores the deployed bodies by md5, the legacy trigger, and the captured contacts; needs a capture of 57 rows', /6725e093234175510332552d94f128ad/.test(drb) && /274c74413a3123241fc9f669042b3e3d/.test(drb) && /CREATE TRIGGER update_contact_stats_trigger/.test(drb) && /\{\{CAPTURE_JSON\}\}/.test(drb) && /expected 57/.test(drb));
ok('durable D20 fingerprint prediction is read-only and states the predicted digests (fn 84 rows, trg 39 rows)', !/^\s*(insert|update|delete|alter|create|drop|grant|revoke)\b/im.test(dfp.replace(/--.*$/gm, '')) && /32f59f0ec0d7363565e290c2d3065a3b/.test(dfp) && /939498986d6ddad3dd105070bc326e0c/.test(dfp));
ok('the earlier D20 Part 1 files are marked superseded and not to be run alone', /SUPERSEDED/.test(d20plan) && /do NOT run this file alone/.test(d20sql));
const syncCfg = fs.readFileSync(path.join(ROOT, 'scripts', 'SyncDevDataFromProd', 'lib', 'config.mjs'), 'utf8');
ok('the Production-to-Development refresh lists the three new D20 triggers as reviewed (a superset until the obsolete one is removed)', /'order_custom_fees\.trigger_update_contact_stats_order_fees'/.test(syncCfg) && /'order_discounts\.trigger_update_contact_stats_order_discounts'/.test(syncCfg) && /'contacts\.trigger_update_contact_stats_new_contact'/.test(syncCfg));
ok('SEC-005: indefinite-ban completion, residual risks, rotate-before-unban and contained-not-remediated are documented', /Completing the remediation: extend the bans/.test(sec) && /rotated \(section 5\) \*\*before\*\* either account is ever unbanned/.test(sec) && /\*\*contained\*\*/.test(sec) && /not permanently remediated/.test(sec));

ok('the correction is marked prepared and not authorized', /NOT AUTHORIZED, NOT EXECUTED/.test(d20sql) && /PLAN FOR SEPARATE AUTHORIZATION/.test(d20plan));

console.log(`attestation decision sheet: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
