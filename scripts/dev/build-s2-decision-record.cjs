#!/usr/bin/env node
// Builds the S2 decision record for the owner's explicit 44 decisions supplied by chat message (2026-10-20), using the SAME logic block as the HTML sheet.
// Read-only apart from writing the record file. Fails closed on any mismatch. The owner supplied the two qualified-scope hashes in the message; they are recomputed independently here.
// Usage: node scripts/dev/build-s2-decision-record.cjs <attestor> <utcIso> <outFile>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const S4 = path.join(__dirname, '..', '..', 'audit', 'step4');
const html = fs.readFileSync(path.join(S4, 's2-attestation-decision-sheet.html'), 'utf8');
const logic = html.match(/<script id="logic">([\s\S]*?)<\/script>/)[1];
const lib = new Function(logic + '\nreturn { sha256: sha256, buildRecord: buildRecord };')();
const rows = JSON.parse(html.match(/^var DATA = (\[.*\]);$/m)[1]);
const QW = JSON.parse(fs.readFileSync(path.join(S4, 's2-qualified-attestations.json'), 'utf8'));

// the owner's message: D01..D44 all ATTEST, D20 and D21 "ATTEST - QUALIFIED SCOPE ONLY", with these migration versions, batches and scope hashes
const OWNER = {
  decisions: Array.from({ length: 44 }, (_, i) => 'D' + String(i + 1).padStart(2, '0')),
  d20: { version: '20260323164559', batch: 'B21', sha256: '28d222463b445da011a4828029f10187ba23d152f1bcbf16d740be387edb07ec' },
  d21: { version: '20251003170350', batch: 'B22', sha256: 'bf040e876d534c49ed2828cc9d63c5bca2520cc49b79234eb7a896304ce4850f' },
};

function fail(m) { console.error('STOP: ' + m); process.exit(1); }

const [attestor, utc, out] = process.argv.slice(2);
if (!attestor || !utc || !out) fail('usage: build-s2-decision-record.cjs <attestor> <utcIso> <outFile>');
if (rows.length !== 44) fail('sheet does not hold 44 rows');
if (new Set(rows.map((r) => r.id)).size !== 44 || new Set(rows.map((r) => r.version)).size !== 44) fail('ids or versions are not unique');
if (JSON.stringify(rows.map((r) => r.id)) !== JSON.stringify(OWNER.decisions)) fail('sheet ids differ from D01..D44');
for (const [id, o] of [['D20', OWNER.d20], ['D21', OWNER.d21]]) {
  const r = rows.find((x) => x.id === id);
  if (r.version !== o.version || r.batch !== o.batch) fail(`${id} maps to ${r.version}/${r.batch}, the owner named ${o.version}/${o.batch}`);
  const h = crypto.createHash('sha256').update(QW[id].scope + '\n' + QW[id].not_proven, 'utf8').digest('hex');
  if (h !== o.sha256) fail(`${id} qualified-scope hash recomputed ${h} differs from the owner-supplied ${o.sha256}`);
  if (r.qual_sha256 !== h || QW[id].sha256 !== h) fail(`${id} sheet or JSON hash differs`);
}
const choices = {};
rows.forEach((r) => { choices[r.id] = 'ATTEST'; });
const rec = lib.buildRecord(rows, choices, attestor, utc);
if (rec.error) fail('record error ' + JSON.stringify(rec));
fs.writeFileSync(out, rec.text + '\n', { encoding: 'utf8' });
console.log(JSON.stringify({ out, attest: rec.attest, reject: rec.reject, record_sha256: rec.hash, d20_sha256: OWNER.d20.sha256, d21_sha256: OWNER.d21.sha256, file_sha256: crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex') }, null, 1));
