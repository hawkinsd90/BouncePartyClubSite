// Defect: StatusChangeDialog wrote `field_name` and `changed_by` into order_changelog. Neither is a column, so the history insert was refused AFTER
// the order's status had already been changed: the Admin saw "Failed to update status" for a change that had been made. The database side of the
// contract (the real column set is accepted for an Admin, the old one is refused with 42703, customers are refused) is executed in
// coreDatabaseAccess ("status dialog: ..." scenarios). This file pins the row builder and the dialog's use of it.
import { readFileSync } from 'node:fs';
import { statusChangeLogRow } from '../../orders/statusChangeLog';

let passed = 0;
let failed = 0;
function eq(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}\n  got:      ${JSON.stringify(got)}\n  expected: ${JSON.stringify(want)}`);
  }
}
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}

const REAL_COLUMNS = ['id', 'order_id', 'user_id', 'field_changed', 'old_value', 'new_value', 'change_type', 'created_at', 'notes'];
const row = statusChangeLogRow({ orderId: 'o1', currentStatus: 'pending_review', pendingStatus: 'confirmed', reason: '  Customer called  ', userId: 'u1' });
eq('the row has exactly the status-change fields', Object.keys(row).sort(), ['change_type', 'field_changed', 'new_value', 'old_value', 'order_id', 'user_id']);
ok('every key is a real order_changelog column', Object.keys(row).every((k) => REAL_COLUMNS.includes(k)));
eq('values: status change, old status, new status with the trimmed reason', [row.change_type, row.field_changed, row.old_value, row.new_value, row.user_id, row.order_id], ['status_change', 'status', 'pending_review', 'confirmed (Reason: Customer called)', 'u1', 'o1']);
eq('no reason: no suffix', statusChangeLogRow({ orderId: 'o', currentStatus: 'a', pendingStatus: 'b', reason: '   ', userId: null }).new_value, 'b');
eq('no signed-in user: user_id is null', statusChangeLogRow({ orderId: 'o', currentStatus: 'a', pendingStatus: 'b', reason: '', userId: null }).user_id, null);

const dialog = readFileSync('src/components/order-detail/StatusChangeDialog.tsx', 'utf8').replace(/\r\n/g, '\n');
const insertBlock = /from\('order_changelog'\)\.insert\(([\s\S]*?)\);\n\n/.exec(dialog)?.[1] ?? '';
ok('the dialog found its changelog insert', insertBlock.length > 0);
ok('the dialog writes the row through statusChangeLogRow', /statusChangeLogRow\(/.test(insertBlock));
ok('the dialog no longer names the nonexistent columns field_name / changed_by', !/field_name|changed_by/.test(dialog));
ok('a changelog failure is still surfaced to the Admin (the insert error is thrown, not swallowed)', /if \(changelogError\) throw changelogError;/.test(dialog));
ok('the types file no longer claims the nonexistent columns on order_changelog', !/order_changelog: \{[\s\S]{0,400}?(field_name|changed_by)/.test(readFileSync('src/lib/database.types.ts', 'utf8')));

console.log(`statusChangeLog: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} status change log test(s) failed`);
