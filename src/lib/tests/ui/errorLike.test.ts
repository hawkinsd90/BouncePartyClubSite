// asErrorLike: the typed replacement for reading properties off a caught value that used to be `any`.
import { asErrorLike } from '../../core/errorLike';

let passed = 0;
let failed = 0;
function eq(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}\n  got:      ${JSON.stringify(got)}\n  expected: ${JSON.stringify(want)}`);
  }
}

const real = new Error('boom');
eq('an Error keeps its message', asErrorLike(real).message, 'boom');
eq('the same object is returned (properties are read from it, not copied)', asErrorLike(real) === (real as unknown), true);
const supa = { message: 'row-level security', code: '42501', status: 403, details: 'd', hint: 'h' };
eq('a Supabase-style error keeps code, status, details and hint', [asErrorLike(supa).code, asErrorLike(supa).status, asErrorLike(supa).details, asErrorLike(supa).hint], ['42501', 403, 'd', 'h']);
eq('a thrown string has no message (as `.message` of a string was undefined)', asErrorLike('oops').message, undefined);
eq('null and undefined have no message and do not throw', [asErrorLike(null).message, asErrorLike(undefined).message], [undefined, undefined]);
eq('a number has none either', asErrorLike(42).code, undefined);
eq('the fallback pattern still works', asErrorLike(null).message || 'Failed to save', 'Failed to save');
eq('an object without a message uses the fallback', asErrorLike({}).message || 'Failed to save', 'Failed to save');

console.log(`errorLike: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} errorLike test(s) failed`);
