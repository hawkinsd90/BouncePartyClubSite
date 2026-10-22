// WP-18: the Admin-visible travel-fee city review, built on the EXISTING order_changelog table (no new schema).
// Server recorder (idempotent, best effort), the Admin reads (pending card, order detail, new-booking alert) and escaping.
// PASS - LOCAL AUTOMATED / MOCKED. The end-to-end rows are also asserted in publicBookingSecurity (create-booking) and staffOrderSave
// (real scratch Postgres). The alert delivery itself (SMS/email) and the Admin screens on a device are REQUIRES HOSTED DEV VERIFICATION.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import {
  escapeHtml,
  loadTravelCityReviewNotes,
  recordTravelCityReview,
  travelCityReviewNote,
  TRAVEL_CITY_REVIEW_CHANGE_TYPE,
  TRAVEL_CITY_REVIEW_SMS_SUFFIX,
} from '../../../../supabase/functions/_shared/booking/travelCityReview';
import { latestTravelCityReviewNote, TRAVEL_CITY_REVIEW_CHANGE_TYPE as UI_TYPE } from '../../orders/travelCityReview';

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

function fakeDb(opts: { failInsert?: boolean; throwOnRead?: boolean } = {}) {
  const rows: any[] = [];
  const db: any = {
    rows,
    from: (t: string) => {
      if (t !== 'order_changelog') throw new Error('unexpected table ' + t);
      const filters: Array<[string, unknown]> = [];
      const api: any = {
        select: () => api,
        eq: (c: string, v: unknown) => (filters.push([c, v]), api),
        order: () => api,
        limit: () => api,
        insert: async (row: any) => {
          if (opts.failInsert) return { error: { message: 'boom' } };
          rows.push({ created_at: `2026-01-0${rows.length + 1}T00:00:00Z`, ...row });
          return { error: null };
        },
        then: (res: any, rej: any) => {
          if (opts.throwOnRead) return Promise.reject(new Error('read exploded')).then(res, rej);
          return Promise.resolve({ data: rows.filter((r) => filters.every(([c, v]) => r[c] === v)), error: null }).then(res, rej);
        },
      };
      return api;
    },
  };
  return db;
}

(async () => {
  // --- wording ---
  ok('both sides use the same change type', TRAVEL_CITY_REVIEW_CHANGE_TYPE === UI_TYPE && UI_TYPE === 'travel_city_review');
  const n1 = travelCityReviewNote('typed_free_city_not_verified', 'Detroit', null);
  ok('unverified: names the typed city, says the distance fee applied, says what to do', /"Detroit"/.test(n1) && /could not be confirmed/.test(n1) && /distance-based travel fee was applied/.test(n1) && /waive the travel fee with a reason/.test(n1));
  const n2 = travelCityReviewNote('typed_free_city_contradicted', 'Detroit', 'Utica');
  ok('contradicted: names both cities', /"Detroit"/.test(n2) && /"Utica"/.test(n2) && /another city|in "Utica"/.test(n2));
  ok('contradicted without a verified city still reads sensibly', /another city/.test(travelCityReviewNote('typed_free_city_contradicted', 'Detroit', null)));
  ok('a blank typed city is shown as (blank)', /\(blank\)/.test(travelCityReviewNote('typed_free_city_not_verified', '   ', null)));

  // --- recorder ---
  {
    const db = fakeDb();
    const input = { orderId: 'o1', travelCity: { review: 'typed_free_city_not_verified' as const, city: '', status: 'unverified' as const }, typedCity: ' Detroit ', userId: null };
    ok('records one row', (await recordTravelCityReview(db, input)) === true && db.rows.length === 1);
    const r = db.rows[0];
    ok('the row has the order, change type, field, typed city, outcome code and a note', r.order_id === 'o1' && r.change_type === 'travel_city_review' && r.field_changed === 'travel_city' && r.old_value === 'Detroit' && r.new_value === 'typed_free_city_not_verified' && /Detroit/.test(r.notes) && r.user_id === null);
    ok('recording the same outcome again adds no second row', (await recordTravelCityReview(db, input)) === true && db.rows.length === 1);
    await recordTravelCityReview(db, { ...input, travelCity: { review: 'typed_free_city_contradicted', city: 'Utica', status: 'verified_mismatch' } });
    ok('a different outcome for the same order is a new row (history)', db.rows.length === 2 && /Utica/.test(db.rows[1].notes));
    await recordTravelCityReview(db, { ...input, orderId: 'o2' });
    ok('another order gets its own row', db.rows.length === 3);
    ok('a staff member id is stored when given', (await recordTravelCityReview(db, { ...input, orderId: 'o3', userId: 'u9' })) && db.rows[3].user_id === 'u9');
    ok('nothing to review records nothing', (await recordTravelCityReview(db, { ...input, orderId: 'o4', travelCity: { review: null, city: 'Detroit', status: 'verified_match' } })) === false && db.rows.length === 4);
    ok('no order id records nothing', (await recordTravelCityReview(db, { ...input, orderId: '' })) === false && db.rows.length === 4);
  }
  {
    const quiet = console.error;
    const logged: string[] = [];
    console.error = (...a: unknown[]) => void logged.push(a.join(' '));
    try {
      const failing = fakeDb({ failInsert: true });
      const input = { orderId: 'o1', travelCity: { review: 'typed_free_city_not_verified' as const, city: '', status: 'unverified' as const }, typedCity: 'Detroit', userId: null };
      ok('a failed insert returns false, never throws, and is logged', (await recordTravelCityReview(failing, input)) === false && logged.some((l) => /could not record the review/.test(l)));
      const exploding = fakeDb({ throwOnRead: true });
      ok('a read that throws is swallowed (best effort) and logged', (await recordTravelCityReview(exploding, input)) === false);
      ok('a client without the table at all is swallowed too', (await recordTravelCityReview({ from: () => { throw new Error('no table'); } }, input)) === false);
    } finally {
      console.error = quiet;
    }
  }

  // --- reads ---
  {
    const db = fakeDb();
    ok('no notes for an order without a review', (await loadTravelCityReviewNotes(db, 'o1')).length === 0);
    await recordTravelCityReview(db, { orderId: 'o1', travelCity: { review: 'typed_free_city_not_verified', city: '', status: 'unverified' }, typedCity: 'Detroit', userId: null });
    const notes = await loadTravelCityReviewNotes(db, 'o1');
    ok('the alert reads back the recorded note', notes.length === 1 && /Detroit/.test(notes[0]));
    ok('a failing read gives [] (the alert is sent without the line)', (await loadTravelCityReviewNotes(fakeDb({ throwOnRead: true }), 'o1')).length === 0);
  }
  ok('escapeHtml neutralizes customer text before it goes into the email', escapeHtml('<script>alert("x")</script> & \'q\'') === '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;');

  // --- Admin screen helper ---
  ok('no rows / other change types -> no banner', latestTravelCityReviewNote(undefined) === null && latestTravelCityReviewNote([]) === null && latestTravelCityReviewNote([{ change_type: 'field_update', notes: 'x' }]) === null);
  ok('the newest review note wins', latestTravelCityReviewNote([{ change_type: 'travel_city_review', notes: 'old', created_at: '2026-01-01' }, { change_type: 'travel_city_review', notes: 'new', created_at: '2026-02-01' }, { change_type: 'status_change', notes: 'zzz', created_at: '2026-03-01' }]) === 'new');
  ok('a review row without a note still shows a generic line', /could not be confirmed/.test(latestTravelCityReviewNote([{ change_type: 'travel_city_review', notes: null }]) ?? ''));

  // --- wiring ---
  const create = read('supabase/functions/_shared/booking/createBooking.ts');
  ok('create-booking records the review after the order exists and never before the RPC succeeded', create.indexOf('recordTravelCityReview(deps.db') > create.indexOf('p_caller_user_id') && /if \(plan\.travelCity\.review\) \{\n\s+await recordTravelCityReview/.test(create));
  const staff = read('supabase/functions/_shared/orders/staff-order-save.ts');
  ok('staff-order-save records the review for an edit and for a new invoice, after the save succeeded', (staff.match(/recordTravelCityReview\(db,/g) ?? []).length === 2 && staff.indexOf('recordTravelCityReview(db') > staff.indexOf('apply_staff_order_save'));
  const lifecycle = read('supabase/functions/order-lifecycle/index.ts');
  ok('the new-booking alert reads the recorded review and adds it to the text and the email (escaped)', /loadTravelCityReviewNotes\(supabase, order\.id\)/.test(lifecycle) && lifecycle.includes('TRAVEL_CITY_REVIEW_SMS_SUFFIX') && lifecycle.includes('escapeHtml(travelReviewNotes[0])') && /Travel fee needs a look/.test(lifecycle));
  ok('the alert text is short and plain', TRAVEL_CITY_REVIEW_SMS_SUFFIX.length < 90 && !/[<>]/.test(TRAVEL_CITY_REVIEW_SMS_SUFFIX));
  const admin = read('src/pages/Admin.tsx');
  ok('the Admin order lists load only the review rows with each order', (admin.match(/order_changelog \(change_type, notes, created_at\)/g) ?? []).length === 1 && (admin.match(/\.eq\('order_changelog\.change_type', 'travel_city_review'\)/g) ?? []).length === 2);
  const info = read('src/components/pending-order/OrderInfoSection.tsx');
  ok('the pending booking card shows the warning', /latestTravelCityReviewNote\(order\.order_changelog\)/.test(info) && /Travel fee needs a look/.test(info) && /role="alert"/.test(info));
  const detail = read('src/components/admin/orders/OrderDetailModal.tsx');
  ok('the order detail shows the warning above every tab, from the loaded history', /latestTravelCityReviewNote\(changelog\)/.test(detail) && /Travel fee needs a look/.test(detail));
  const history = read('src/components/order-detail/OrderChangelogTab.tsx');
  ok('the Change History tab lists the row (generic rendering of change type, field, values and note)', /change\.notes/.test(history));

  console.log(`travelCityReview: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} travel city review test(s) failed`);
})();
