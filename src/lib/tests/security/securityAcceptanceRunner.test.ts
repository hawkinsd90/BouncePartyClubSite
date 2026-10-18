// The Step 3 security ACCEPTANCE runner (scripts/dev/security-scratch.cjs): its verdict logic must never turn a missing database, a missing
// test, a skipped layer, a crash or an unrelated baseline failure into a green result. These are the pure decision functions fed with
// synthetic outputs (no database needed). The end-to-end negative controls, which run the real command against a renamed database,
// a forced SKIPPED suite and a broken baseline, are described in audit/security/step3b-implementation-report.md.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;
const fs = require('fs');
const runner = require('../../../../scripts/dev/security-scratch.cjs');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
const NL = String.fromCharCode(10);
const lines = (...l: string[]) => l.join(NL);

const GOOD = lines('Security posture tests: 94 passed, 0 failed');
const SKIPPED = lines('EXECUTED layer SKIPPED: no scratch database', 'Some tests: 12 passed, 0 failed');
const SKIPPED_COUNT = lines('migration plan: 80 passed, 0 failed, 2 skipped');
const FAILING = lines('FAIL: executed: SEC-001 something (got 1)', 'Security posture tests: 93 passed, 1 failed');
const CRASH = lines('C:\\x\\jiti.js:2', '  throw err;', 'Error: ParseError: Unexpected token');

// ---- normal runs ----
ok('a clean run is a pass', runner.classifyRun({ code: 0, out: GOOD }).status === 'pass');
ok('a run with a SKIPPED layer is NOT a pass, even with exit code 0', runner.classifyRun({ code: 0, out: SKIPPED }).status === 'skipped');
ok('a run that reports skipped assertions is NOT a pass', runner.classifyRun({ code: 0, out: SKIPPED_COUNT }).status === 'skipped');
ok('a failing assertion is a failure', runner.classifyRun({ code: 1, out: FAILING }).status === 'fail');
ok('a crash with no result line is a failure', runner.classifyRun({ code: 1, out: CRASH }).status === 'fail');
ok('exit code 0 without any result line is a failure (nothing ran)', runner.classifyRun({ code: 0, out: 'hello' }).status === 'fail');
ok('exit code 1 with a clean-looking summary is still a failure', runner.classifyRun({ code: 1, out: GOOD }).status === 'fail');

// ---- baseline: accepted only when it fails exactly as recorded ----
const expected = { passed: 80, failed: 2, total: 82, failures: [{ name: 'SEC-014 anon cannot setval the receipt sequence', got: '1' }, { name: 'SEC-037 every SECURITY DEFINER function pins its search_path', got: '1' }] };
const realBaseline = lines(
  'FAIL: executed: SEC-014 anon cannot setval the receipt sequence (got 1)',
  'FAIL: executed: SEC-037 every SECURITY DEFINER function pins its search_path (got 1)',
  'Security posture tests: 80 passed, 2 failed',
  'Error: 2 security posture test(s) failed');
ok('the recorded baseline failure is accepted', runner.compareBaseline({ code: 1, out: realBaseline }, expected).ok);
ok('a baseline that PASSES is rejected (it demonstrates nothing)', !runner.compareBaseline({ code: 0, out: 'Security posture tests: 82 passed, 0 failed' }, expected).ok);
ok('a baseline that fails an extra, different assertion is rejected', !runner.compareBaseline({ code: 1, out: realBaseline.replace('Security posture tests: 80 passed, 2 failed', 'FAIL: executed: SEC-999 something else (got x)' + NL + 'Security posture tests: 79 passed, 3 failed') }, expected).ok);
ok('a baseline where an expected finding does not fail is rejected', !runner.compareBaseline({ code: 1, out: lines('FAIL: executed: SEC-014 anon cannot setval the receipt sequence (got 1)', 'Security posture tests: 81 passed, 1 failed') }, expected).ok);
ok('a baseline that fails the right assertion with a different observed value is rejected', !runner.compareBaseline({ code: 1, out: realBaseline.replace('receipt sequence (got 1)', 'receipt sequence (got ERR:42501)') }, expected).ok);
ok('a baseline with different totals is rejected', !runner.compareBaseline({ code: 1, out: realBaseline.replace('80 passed, 2 failed', '79 passed, 2 failed') }, expected).ok);
ok('an unrelated crash is rejected as a baseline', !runner.compareBaseline({ code: 1, out: CRASH }, expected).ok);
ok('a connection failure is rejected as a baseline', !runner.compareBaseline({ code: 1, out: lines('psql: error: connection to server at "127.0.0.1", port 54329 failed: Connection refused (ECONNREFUSED)', realBaseline) }, expected).ok);
ok('a baseline that reports a SKIPPED layer is rejected', !runner.compareBaseline({ code: 1, out: lines('EXECUTED layer SKIPPED: x', realBaseline) }, expected).ok);
ok('a baseline with a non-assertion FAIL line (for example the script did not run to completion) is rejected', !runner.compareBaseline({ code: 1, out: lines('FAIL: the script did not run', realBaseline) }, expected).ok);

// ---- verdict ----
const pass = { label: 'a', status: 'pass', passed: 10 };
const base = (s: string) => ({ label: 'b', status: s, baseline: true });
const v = (o: any) => runner.verdict({ strict: true, results: [pass, base('pass')], missingDatabases: [], missingTests: [], discovered: 118, minDiscovered: 118, ...o });
ok('a perfect strict run is accepted', v({}).ok);
ok('a missing required database fails acceptance', !v({ missingDatabases: ['bpc_replay_prodshape'] }).ok);
ok('a missing required test file fails acceptance', !v({ missingTests: ['src/lib/tests/security/securityPosture.test.ts'] }).ok);
ok('a shrunken denominator (fewer test files than the manifest requires) fails acceptance', !v({ discovered: 117 }).ok);
ok('one failed run fails acceptance', !v({ results: [pass, { label: 'x', status: 'fail' }, base('pass')] }).ok);
ok('one skipped run fails acceptance', !v({ results: [pass, { label: 'x', status: 'skipped' }, base('pass')] }).ok);
ok('a rejected baseline fails acceptance', !v({ results: [pass, base('fail')] }).ok);
ok('a run that did not execute because its database was missing is not counted as executed', runner.tally([pass, { label: 'x', status: 'not-run' }]).executed === 1 && runner.tally([pass, { label: 'x', status: 'not-run' }]).required === 2);
const diag = (o: any) => runner.verdict({ strict: false, results: [pass], missingDatabases: ['bpc_replay_x'], missingTests: [], discovered: 5, minDiscovered: 118, ...o });
ok('diagnostic mode tolerates missing databases and a small file set but still fails on a failed run', diag({}).ok && !diag({ results: [pass, { label: 'x', status: 'fail' }] }).ok);
ok('strict mode never tolerates them', !runner.verdict({ strict: true, results: [pass], missingDatabases: ['bpc_replay_x'], missingTests: [], discovered: 5, minDiscovered: 118 }).ok);

// ---- the committed manifests ----
const manifest = JSON.parse(fs.readFileSync('audit/security/step3-acceptance-manifest.json', 'utf8'));
const expectedFile = JSON.parse(fs.readFileSync(manifest.baseline_expected, 'utf8')).databases;
ok('the manifest requires the ten scratch databases (six repository-chain, four shaped)', manifest.databases.length === 10 && ['bpc_replay_prodpre', 'bpc_replay_prodshape', 'bpc_replay_devpre4', 'bpc_replay_devshape'].every((d) => manifest.databases.some((x: any) => x.name === d)));
ok('every file the manifest requires exists', manifest.must_exist.every((f: string) => fs.existsSync(f)));
ok('every extra and baseline run names a required database', [...manifest.extra_runs, ...manifest.baseline_runs].every((x: any) => manifest.databases.some((d: any) => d.name === x.db)));
ok('every baseline run has a recorded expectation with at least one finding, and each finding names its issue id', manifest.baseline_runs.every((b: any) => expectedFile[b.baseline] && expectedFile[b.baseline].failures.length > 0 && expectedFile[b.baseline].failures.every((f: any) => /^SEC-\d{3} /.test(f.name))) && expectedFile.bpc_replay_full25.failed === expectedFile.bpc_replay_full25.failures.length);
ok('the manifest does not restrict discovery (the acceptance runs every test file)', manifest.discover_globs === undefined && manifest.min_discovered_test_files >= 118);

console.log(`security acceptance runner tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} security acceptance runner test(s) failed`);
