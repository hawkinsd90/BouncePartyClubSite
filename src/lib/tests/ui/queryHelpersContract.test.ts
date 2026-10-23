// Shared query helpers (src/lib/queries) that nothing called and that named columns the schema does not have were removed:
// getAllUnits / getUnitsByType / getUnitsByCategory (units has no sort_order and no `type`: it has `types text[]`),
// getInvoiceByToken (invoices has no `token`), getAllPayments (orders has no `order_number`).
// This pins that they stay gone and that the remaining helpers in those files name none of those columns.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const units = read('src/lib/queries/units.ts');
const invoices = read('src/lib/queries/invoices.ts');
const payments = read('src/lib/queries/payments.ts');

for (const name of ['getAllUnits', 'getUnitsByType', 'getUnitsByCategory']) ok(`units.ts no longer defines ${name}`, !units.includes(`function ${name}(`));
ok('invoices.ts no longer defines getInvoiceByToken', !/function getInvoiceByToken\b/.test(invoices));
ok('payments.ts no longer defines getAllPayments', !/function getAllPayments\b/.test(payments));
ok("units helpers name no sort_order and no `type` filter (units has `types text[]`)", !/sort_order/.test(units) && !/\.eq\('type'/.test(units));
ok('invoices helpers do not filter on a token column', !/\.eq\('token'/.test(invoices));
ok('payments helpers do not embed orders.order_number', !/order_number/.test(payments));
const callers = ['getAllUnits', 'getUnitsByType', 'getUnitsByCategory', 'getInvoiceByToken', 'getAllPayments'];
// git grep exits 1 when nothing matches
const found = spawnSync('git', ['grep', '-l', '-E', callers.join('|'), '--', 'src', 'supabase/functions', ':!src/lib/tests'], { encoding: 'utf8' });
const hits = (found.stdout ?? '').split('\n').filter(Boolean);
ok(`nothing in src or supabase/functions refers to the removed helpers (${hits.join(', ') || 'none'})`, hits.length === 0);

console.log(`queryHelpersContract: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} query helper test(s) failed`);
