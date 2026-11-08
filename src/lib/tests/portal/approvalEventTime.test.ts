// WP-P1-13 (F-49): the customer approval page must show the event START/END time, not only date and address. Pure formatter rules plus a
// SOURCE-LEVEL check that OrderApprovalView renders it (not a UI integration test). Browser check NT-08 is NOT RUN.
import { readFileSync } from 'node:fs';
import { approvalEventTime } from '../../portal/approvalEventTime';

let passed = 0;
let failed = 0;
function eq(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.error(`FAIL ${label} (got ${JSON.stringify(got)}, expected ${JSON.stringify(want)})`);
  }
}
function ok(label: string, cond: boolean) { eq(label, cond, true); }

// current time: start_window/end_window, no seconds
eq('window with seconds shows no seconds', approvalEventTime({ start_window: '09:30:00', end_window: '17:00:00' }), { current: '9:30 AM - 5:00 PM', previous: null });
eq('falls back to event_start_time/event_end_time', approvalEventTime({ start_window: null, end_window: null, event_start_time: '13:15', event_end_time: '18:45' }), { current: '1:15 PM - 6:45 PM', previous: null });
eq('midnight/noon formatting', approvalEventTime({ start_window: '00:05', end_window: '12:00' }), { current: '12:05 AM - 12:00 PM', previous: null });
eq('only a start time', approvalEventTime({ start_window: '10:00:00' }), { current: '10:00 AM', previous: null });
eq('no time at all -> nothing to show', approvalEventTime({}), null);

// time-only edit: the earliest old value in the history is the time the customer last saw
const log = [
  { field_changed: 'end_window', old_value: '17:00:00', new_value: '20:00:00', created_at: '2030-01-02T10:00:00Z' },
  { field_changed: 'end_window', old_value: '20:00:00', new_value: '21:00:00', created_at: '2030-01-03T10:00:00Z' },
  { field_changed: 'event_date', old_value: '2030-01-05', new_value: '2030-01-06', created_at: '2030-01-02T10:00:00Z' },
];
eq('end time edited: previous shows the original range', approvalEventTime({ start_window: '09:30:00', end_window: '21:00:00' }, log), { current: '9:30 AM - 9:00 PM', previous: '9:30 AM - 5:00 PM' });
eq('start time edited', approvalEventTime({ start_window: '11:00:00', end_window: '17:00:00' }, [{ field_changed: 'start_window', old_value: '09:00:00', new_value: '11:00:00', created_at: 'x' }]), { current: '11:00 AM - 5:00 PM', previous: '9:00 AM - 5:00 PM' });
eq('edited back to the same time -> no previous', approvalEventTime({ start_window: '09:00:00', end_window: '17:00:00' }, [{ field_changed: 'start_window', old_value: '09:00:00', new_value: '09:00:00', created_at: 'x' }]), { current: '9:00 AM - 5:00 PM', previous: null });
eq('unrelated changelog rows do not invent a previous time', approvalEventTime({ start_window: '09:00', end_window: '17:00' }, [{ field_changed: 'travel_fee_cents', old_value: '0', new_value: '1000' }]), { current: '9:00 AM - 5:00 PM', previous: null });

// SOURCE-LEVEL
const view = readFileSync('src/components/customer-portal/OrderApprovalView.tsx', 'utf8');
ok('source: OrderApprovalView computes and renders the event time', /approvalEventTime\(order, changelog\)/.test(view) && /approval-event-time/.test(view));

console.log(`approvalEventTime: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
