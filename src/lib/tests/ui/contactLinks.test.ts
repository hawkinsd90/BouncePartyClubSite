// WP-21 / WP-22 (B14): phone numbers and addresses as tap targets, and the one set of rules behind them.
// PASS - LOCAL AUTOMATED. Tapping Call / Message / Directions on real phones (C-24, C-25, K-11, K-13) is REQUIRES HOSTED DEV VERIFICATION.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatPhoneAsTyped, formatPhoneDisplay, isUsablePhone, nationalDigits, samePhoneNumber, smsHref, telHref, toE164 } from '../../core/phone';
import { formatAddress, mapsDirectionsUrl, reliableCoordinates } from '../../core/address';
import { validatePhone, formatPhone } from '../../core/validation';

declare const require: (id: string) => any;

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed++;
  else {
    failed++;
    console.error(`FAIL ${label} (got ${g}, expected ${w})`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// --- phone table -----------------------------------------------------------------------------------------------------------
const SAME = ['(313) 889-3860', '313-889-3860', '313.889.3860', '3138893860', '+13138893860', '+1 313 889 3860', '1-313-889-3860', ' (313)889-3860 ', '1 (313) 889-3860'];
for (const raw of SAME) {
  eq(`"${raw}" -> ten digits`, nationalDigits(raw), '3138893860');
  eq(`"${raw}" -> display`, formatPhoneDisplay(raw), '(313) 889-3860');
  eq(`"${raw}" -> E.164`, toE164(raw), '+13138893860');
}
eq('tel and sms hrefs', [telHref('(313) 889-3860'), smsHref('313-889-3860')], ['tel:+13138893860', 'sms:+13138893860']);
for (const bad of ['No phone', 'no phone', 'N/A', 'none', '', '   ', '12345', '31388938601234', 'abc', null, undefined, 3138893860]) {
  ok(`"${String(bad)}" is not a usable number: no display, no E.164, no links`, !isUsablePhone(bad) && formatPhoneDisplay(bad) === '' && toE164(bad) === null && telHref(bad) === null && smsHref(bad) === null);
}
ok('an 11-digit number that does not start with 1 is not accepted', nationalDigits('23138893860') === null);
ok('comparison ignores formatting and the country code; a different number or a blank never matches', samePhoneNumber('(313) 889-3860', '+1 313-889-3860') && !samePhoneNumber('(313) 889-3860', '(313) 889-3861') && !samePhoneNumber('', '') && !samePhoneNumber('No phone', 'No phone'));

// --- typing and pasting ----------------------------------------------------------------------------------------------------
eq('typing builds the mask', ['3', '313', '3138', '313889', '3138893', '3138893860'].map(formatPhoneAsTyped), ['(3', '(313', '(313) 8', '(313) 889', '(313) 889-3', '(313) 889-3860']);
eq('pasting +1 numbers is not scrambled or dropped', ['+1 313 889 3860', '1-313-889-3860', '+13138893860'].map(formatPhoneAsTyped), Array(3).fill('(313) 889-3860'));
eq('extra digits beyond ten are cut', formatPhoneAsTyped('31388938601234'), '(313) 889-3860');
eq('empty and junk', [formatPhoneAsTyped(''), formatPhoneAsTyped('abc')], ['', '']);
eq('the form validators use the same rules', [validatePhone('+1 313 889 3860').isValid, validatePhone('313889386').isValid, formatPhone('+1 313 889 3860')], [true, false, '(313) 889-3860']);
const signup = read('src/pages/SignUp.tsx');
ok('sign-up phone box formats with the shared function (a pasted +1 is no longer dropped)', /processed = formatPhoneAsTyped\(value\)/.test(signup) && !/if \(digits\.length > 10\) return;/.test(signup));

// --- addresses and maps --------------------------------------------------------------------------------------------------------
eq('address with unit', formatAddress({ line1: '123 Main St', line2: 'Apt 4', city: 'Detroit', state: 'MI', zip: '48201' }), '123 Main St, Apt 4, Detroit, MI 48201');
eq('missing pieces leave no stray commas', [formatAddress({ line1: '123 Main St', city: 'Detroit' }), formatAddress({ line1: '123 Main St', state: 'MI', zip: '48201' }), formatAddress({})], ['123 Main St, Detroit', '123 Main St, MI 48201', '']);
eq('reliable coordinates', [reliableCoordinates(42.33, -83.04), reliableCoordinates(0, 0), reliableCoordinates(95, 10), reliableCoordinates(10, 200), reliableCoordinates(NaN, 1), reliableCoordinates(null, null)], [{ lat: 42.33, lng: -83.04 }, null, null, null, null, null]);
eq('directions use verified coordinates when there are some', mapsDirectionsUrl({ line1: '123 Main St', city: 'Detroit', lat: 42.33, lng: -83.04 }), 'https://www.google.com/maps/dir/?api=1&destination=42.33%2C-83.04');
eq('otherwise the fully encoded address, unit included', mapsDirectionsUrl({ line1: '123 Main St', line2: 'Apt #4', city: 'Detroit', state: 'MI', zip: '48201', lat: 0, lng: 0 }), 'https://www.google.com/maps/dir/?api=1&destination=123%20Main%20St%2C%20Apt%20%234%2C%20Detroit%2C%20MI%2048201');
eq('special characters are encoded (no injection into the URL)', mapsDirectionsUrl({ line1: 'A&B "St" <x>', city: 'X' }), 'https://www.google.com/maps/dir/?api=1&destination=A%26B%20%22St%22%20%3Cx%3E%2C%20X');
eq('nothing to navigate to gives no URL', mapsDirectionsUrl({}), null);
ok('no Apple Maps assumption', !/maps\.apple|maps:\/\//.test(read('src/lib/core/address.ts')));

// --- components ------------------------------------------------------------------------------------------------------------------
const tsxCache: Record<string, any> = {};
function loadTsx(file: string): any {
  const path = require('path');
  const tsc = require('typescript');
  const abs = path.resolve(file);
  if (tsxCache[abs]) return tsxCache[abs];
  const out = tsc.transpileModule(require('fs').readFileSync(abs, 'utf8'), { compilerOptions: { jsx: tsc.JsxEmit.ReactJSX, module: tsc.ModuleKind.CommonJS, target: tsc.ScriptTarget.ES2020, esModuleInterop: true } }).outputText.split('import.meta.env').join('({})');
  const mod: any = { exports: {} };
  tsxCache[abs] = mod.exports;
  const req = (id: string) => {
    if (!id.startsWith('.')) return require(id);
    const base = path.resolve(path.dirname(abs), id);
    return require('fs').existsSync(base + '.tsx') ? loadTsx(base + '.tsx') : require(base);
  };
  new Function('require', 'module', 'exports', out)(req, mod, mod.exports);
  return mod.exports;
}
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
(globalThis as any).window ??= { location: { origin: 'https://site.test', hash: '', search: '', pathname: '/' }, addEventListener() {}, removeEventListener() {}, localStorage: memory(), sessionStorage: memory() };
const { PhoneLink } = loadTsx('src/components/shared/PhoneLink.tsx');
const { AddressLink } = loadTsx('src/components/shared/AddressLink.tsx');
const html = (el: any) => renderToStaticMarkup(el);
{
  const good = html(createElement(PhoneLink, { phone: '313-889-3860' }));
  ok('PhoneLink shows the number in the national format as a button (the menu is closed until tapped)', />\(313\) 889-3860<\/button>/.test(good) && /aria-haspopup="true"/.test(good) && /aria-expanded="false"/.test(good) && !/href=/.test(good));
  for (const bad of ['No phone', '', null, undefined, '555']) {
    const h = html(createElement(PhoneLink, { phone: bad as any }));
    ok(`PhoneLink with "${String(bad)}" renders plain text, no button, no link`, !/<button/.test(h) && !/<a /.test(h) && /No phone on file/.test(h));
  }
  ok('PhoneLink empty label can be customised', />N\/A</.test(html(createElement(PhoneLink, { phone: null, emptyLabel: 'N/A' }))));
  const src = read('src/components/shared/PhoneLink.tsx');
  ok('the menu offers Copy, Call and Message, uses tel:/sms: from the shared rules, and is a bottom sheet on a phone', /Copy number/.test(src) && /telHref\(phone\)/.test(src) && /smsHref\(phone\)/.test(src) && /fixed inset-x-0 bottom-0/.test(src) && /sm:absolute/.test(src));
  ok('the tap stops the click reaching a clickable card behind it', /e\.stopPropagation\(\)/.test(src));
  const a = html(createElement(AddressLink, { address: { line1: '123 Main St', line2: 'Apt 4', city: 'Detroit', state: 'MI', zip: '48201', lat: 42.33, lng: -83.04 } }));
  ok('AddressLink shows the full address with the unit and links to directions in a new tab, safely', /123 Main St, Apt 4, Detroit, MI 48201/.test(a) && /href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=42\.33%2C-83\.04"/.test(a) && /target="_blank"/.test(a) && /rel="noopener noreferrer"/.test(a));
  ok('AddressLink has a Copy button by default and none when turned off', /aria-label="Copy address"/.test(a) && !/aria-label="Copy address"/.test(html(createElement(AddressLink, { address: '1 Main St, Detroit', showCopy: false }))));
  ok('AddressLink given a text address uses the coordinates when supplied, else the encoded text', /destination=42\.3%2C-83/.test(html(createElement(AddressLink, { address: '1 Main St', coords: { lat: 42.3, lng: -83 } }))) && /destination=1%20Main%20St/.test(html(createElement(AddressLink, { address: '1 Main St' }))));
  ok('AddressLink with no address renders nothing', html(createElement(AddressLink, { address: null })) === '');
}

// --- call sites ---------------------------------------------------------------------------------------------------------------
for (const [file, token] of [
  ['src/components/calendar/TaskCard.tsx', '<PhoneLink phone={task.customerPhone} />'],
  ['src/components/admin/tasks/detail/TaskDetailCustomerInfo.tsx', '<PhoneLink phone={task.customerPhone} />'],
  ['src/components/admin/orders/OrdersManager.tsx', '<PhoneLink phone={order.customers?.phone} />'],
  ['src/components/pending-order/OrderInfoSection.tsx', '<PhoneLink phone={order.customers?.phone} />'],
  ['src/components/dashboard/ReceiptModal.tsx', '<PhoneLink phone={order.customers?.phone} />'],
  ['src/pages/Receipt.tsx', '<PhoneLink phone={order.customers?.phone} />'],
  ['src/components/admin/customers/ContactsList.tsx', '<PhoneLink phone={contact.phone} emptyLabel="N/A" />'],
  ['src/components/customer-portal/SecureAccessRequired.tsx', '<PhoneLink phone="(313) 889-3860" />'],
] as Array<[string, string]>) ok(`${file}: the phone is a PhoneLink`, read(file).includes(token));
ok('task card and task screen link the address to directions with the task coordinates', /<AddressLink address=\{task\.address\} coords=\{\{ lat: task\.lat, lng: task\.lng \}\}/.test(read('src/components/calendar/TaskCard.tsx') + read('src/components/admin/tasks/detail/TaskDetailCustomerInfo.tsx')));
ok('the "No phone" placeholder is gone from the task assembly', !/'No phone'/.test(read('src/lib/tasks/calendarTaskAssembly.ts')));
const edge = read('src/components/admin/tasks/detail/taskEdgeRequests.ts');
ok('a task text with a missing or placeholder recipient never reaches the relay', /'to' in body && !isUsablePhone\(body\.to\)/.test(edge) && edge.indexOf("'to' in body") < edge.indexOf('await currentAccessToken()'));

console.log(`contactLinks: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} contact link test(s) failed`);
