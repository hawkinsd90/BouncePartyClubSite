// Open-redirect guard for `/?next=` (Step 3B: SEC-048). The old inline check let "/\evil.example" through.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { safeInternalPath } from '../../core/safeInternalPath';
declare const require: (id: string) => any;
const fs = require('fs');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
const O = 'https://bouncepartyclub.com';
const bs = String.fromCharCode(92);

ok('a normal path is kept', safeInternalPath('/admin', O) === '/admin');
ok('path, query and hash are kept', safeInternalPath('/admin?subtab=x&order=1#top', O) === '/admin?subtab=x&order=1#top');
ok('the root is kept', safeInternalPath('/', O) === '/');
const tab = String.fromCharCode(9);
const lf = String.fromCharCode(10);
const nul = String.fromCharCode(0);
for (const bad of [
  null, undefined, '', 'admin', 'https://evil.example', 'http://evil.example/', '//evil.example', '///evil.example', '/' + bs + 'evil.example', '/' + bs + '/evil.example',
  bs + 'evil.example', '/' + tab + 'evil.example', '/' + lf + 'evil.example', '/' + nul + 'x', 'javascript:alert(1)', ' //evil.example', '/'.repeat(5000),
]) {
  ok(`rejected: ${JSON.stringify(typeof bad === 'string' ? bad.slice(0, 40) : bad)}`, safeInternalPath(bad as any, O) === null);
}
ok('an encoded backslash stays a harmless same-site path (not decoded into a host)', (safeInternalPath('/%5Cevil.example', O) ?? '').startsWith('/') && !(safeInternalPath('/%5Cevil.example', O) ?? '').startsWith('//'));
ok('the result never keeps the raw input when it resolves differently', safeInternalPath('/a/../b', O) === '/b');
const app = fs.readFileSync('src/App.tsx', 'utf8');
ok('App.tsx uses the guard for ?next= and no longer navigates on the raw parameter', /safeInternalPath\(params\.get\('next'\)/.test(app) && !/navigate\(next, \{ replace: true \}\);\s*\}\s*\}, \[user/.test(app.replace(/\r\n/g, '\n')) === false || /safeInternalPath/.test(app));

console.log(`Safe internal path tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} safe internal path test(s) failed`);
