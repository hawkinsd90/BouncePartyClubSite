#!/usr/bin/env node
// Validates the owner's pasted "S2 ATTESTATION DECISIONS" record against the reviewed sheet. Read-only; touches no database.
// Usage: node scripts/dev/validate-attestation-decisions.cjs <record.txt> [--json]
// Exit 0 = record is complete, internally consistent and matches the sheet; prints the dependency-safe batch plan.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SHEET = path.join(__dirname, '..', '..', 'audit', 'step4', 's2-attestation-decision-sheet.html');
// batch execution order = the dependency-safe order of build_execution_package.BORDER for the attestation batches
const ATT_BATCH_ORDER = ['B13', 'B14', 'B15', 'B16', 'B17', 'B18', 'B19', 'B20', 'B21', 'B22', 'B37'];
// history-only batches that unblock only when every listed attestation batch is recorded
const BLOCKED = { B31: ['B18', 'B21'], B33: ['B21'], B40: ['B31', 'B33'] };

function loadRows() {
  const h = fs.readFileSync(SHEET, 'utf8');
  const m = h.match(/^var DATA = (\[.*\]);$/m);
  if (!m) throw new Error('sheet DATA not found');
  return JSON.parse(m[1]);
}

function validate(text, rows) {
  const errors = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const hdr = lines.findIndex((l) => l.startsWith('SHA-256 of the list below: '));
  if (lines[0] !== 'S2 ATTESTATION DECISIONS' || hdr < 0) return { ok: false, errors: ['not a decision record'] };
  const claimed = lines[hdr].slice('SHA-256 of the list below: '.length).trim();
  const attestor = (lines.find((l) => l.startsWith('Attestor: ')) || '').slice(10).trim();
  if (!attestor) errors.push('attestor name missing');
  const bodyLines = lines.slice(hdr + 1).filter((l) => l.length);
  const body = bodyLines.join('\n');
  const actual = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  if (actual !== claimed) errors.push(`record hash mismatch: claimed ${claimed}, computed ${actual}`);
  const decisions = {};
  rows.forEach((r, i) => {
    const l = bodyLines[i];
    const want = `${r.id} ${r.version} ${r.batch} `;
    if (!l || !l.startsWith(want)) { errors.push(`line ${i + 1}: expected "${want}ATTEST|REJECT"`); return; }
    const d = l.slice(want.length);
    if (d !== 'ATTEST' && d !== 'REJECT') errors.push(`${r.id}: decision must be ATTEST or REJECT`);
    decisions[r.id] = d;
  });
  const extra = bodyLines.slice(rows.length);
  const wantQ = rows.filter((r) => r.qual && decisions[r.id] === 'ATTEST').map((r) => `${r.id} QUALIFIED-SCOPE-SHA256 ${r.qual_sha256}`);
  if (JSON.stringify(extra) !== JSON.stringify(wantQ)) errors.push(`qualified-scope lines differ: expected ${JSON.stringify(wantQ)}, found ${JSON.stringify(extra)}`);
  const att = Object.values(decisions).filter((d) => d === 'ATTEST').length;
  const cnt = (lines.find((l) => l.startsWith('Attest: ')) || '');
  if (cnt !== `Attest: ${att} Reject: ${rows.length - att}`) errors.push(`count line "${cnt}" does not match ${att}/${rows.length - att}`);
  if (errors.length) return { ok: false, errors };

  // batch plan: a batch is executable only if every version in it is ATTEST (batches are never split unless the owner asks)
  const plan = [];
  const pending = [];
  for (const b of ATT_BATCH_ORDER) {
    const vs = rows.filter((r) => r.batch === b);
    const rej = vs.filter((r) => decisions[r.id] !== 'ATTEST').map((r) => r.id);
    if (rej.length === 0) plan.push({ batch: b, versions: vs.map((r) => r.version), ids: vs.map((r) => r.id), qualified: vs.filter((r) => r.qual).map((r) => r.id) });
    else pending.push({ batch: b, rejected: rej, partial: rej.length < vs.length, resplit_needed: rej.length < vs.length });
  }
  const recorded = new Set(plan.map((p) => p.batch));
  const waiting = [];
  const state = new Set(recorded);
  for (const b of ['B31', 'B33', 'B40']) {
    if (BLOCKED[b].every((d) => state.has(d))) state.add(b); else waiting.push({ batch: b, missing: BLOCKED[b].filter((d) => !state.has(d)) });
  }
  return { ok: true, attestor, hash: actual, attest: att, reject: rows.length - att, plan, pending, history_only_unblocked: ['B31', 'B33', 'B40'].filter((b) => state.has(b)), history_only_waiting: waiting };
}

module.exports = { validate, loadRows, ATT_BATCH_ORDER, BLOCKED };

if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error('usage: validate-attestation-decisions.cjs <record.txt> [--json]'); process.exit(2); }
  const r = validate(fs.readFileSync(f, 'utf8'), loadRows());
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
