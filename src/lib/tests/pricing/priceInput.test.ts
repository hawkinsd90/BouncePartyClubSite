// Characterization tests for the pure price input helpers.
//
// These describe the CURRENT behavior of parsePrice, priceErrorMessage and
// centsToDollars (moved verbatim from lib/queries/products.ts). They are not
// a statement of desired behavior: if a case looks odd (for example a
// negative cents value), it is pinned here because that is what the code does.
// The re-export from queries/products is covered by typecheck and build, since
// real importers use that path.

import { parsePrice, priceErrorMessage, centsToDollars } from '../../priceInput';

let passed = 0;
let failed = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; } else { failed++; console.error(`FAIL ${label}: expected ${e}, got ${a}`); }
}

// --- parsePrice: empty input -------------------------------------------------

eq('empty string is valid with null cents', parsePrice(''), { valid: true, cents: null });
eq('whitespace-only is valid with null cents', parsePrice('   '), { valid: true, cents: null });

// --- parsePrice: valid amounts -----------------------------------------------

eq('whole dollars', parsePrice('12'), { valid: true, cents: 1200 });
eq('one decimal place', parsePrice('12.5'), { valid: true, cents: 1250 });
eq('two decimal places', parsePrice('12.50'), { valid: true, cents: 1250 });
eq('zero', parsePrice('0'), { valid: true, cents: 0 });
eq('zero with decimals', parsePrice('0.00'), { valid: true, cents: 0 });
eq('cents only', parsePrice('0.05'), { valid: true, cents: 5 });
eq('surrounding whitespace is trimmed', parsePrice('  12.50  '), { valid: true, cents: 1250 });
eq('leading zeros are accepted', parsePrice('007.50'), { valid: true, cents: 750 });

// --- parsePrice: rounding (float artifacts are rounded to whole cents) --------

eq('0.29 rounds to 29 cents', parsePrice('0.29'), { valid: true, cents: 29 });
eq('1.15 rounds to 115 cents', parsePrice('1.15'), { valid: true, cents: 115 });
eq('19.99 rounds to 1999 cents', parsePrice('19.99'), { valid: true, cents: 1999 });

// --- parsePrice: format errors -----------------------------------------------

const formatError = { valid: false, reason: 'format' };
eq('letters are a format error', parsePrice('abc'), formatError);
eq('negative is a format error', parsePrice('-5'), formatError);
eq('explicit plus sign is a format error', parsePrice('+5'), formatError);
eq('currency symbol is a format error', parsePrice('$12'), formatError);
eq('thousands separator is a format error', parsePrice('1,000'), formatError);
eq('three decimal places is a format error', parsePrice('12.345'), formatError);
eq('trailing dot is a format error', parsePrice('12.'), formatError);
eq('leading dot is a format error', parsePrice('.5'), formatError);
eq('exponent notation is a format error', parsePrice('1e3'), formatError);
eq('inner whitespace is a format error', parsePrice('1 2'), formatError);

// --- parsePrice: size limits -------------------------------------------------

eq('largest allowed amount', parsePrice('21474836.47'), { valid: true, cents: 2147483647 });
eq('one cent over the limit is too_large', parsePrice('21474836.48'), { valid: false, reason: 'too_large' });
eq('absurdly large amount is too_large', parsePrice('99999999999999999999'), { valid: false, reason: 'too_large' });

// --- priceErrorMessage ---------------------------------------------------------

eq('too_large message', priceErrorMessage('too_large'), 'Price is too large.');
eq('format message', priceErrorMessage('format'), 'Enter a valid dollar amount (e.g. 12, 12.50)');

// --- centsToDollars ------------------------------------------------------------

eq('null becomes empty string', centsToDollars(null), '');
eq('undefined becomes empty string', centsToDollars(undefined), '');
eq('zero cents', centsToDollars(0), '0.00');
eq('single-digit cents', centsToDollars(5), '0.05');
eq('whole dollars', centsToDollars(100), '1.00');
eq('dollars and cents', centsToDollars(1250), '12.50');
eq('trailing zero is kept', centsToDollars(1005), '10.05');
eq('maximum cents value', centsToDollars(2147483647), '21474836.47');
eq('negative cents keep their sign', centsToDollars(-150), '-1.50');

// --- round trip ----------------------------------------------------------------

eq('parsePrice(centsToDollars(1999)) round-trips', parsePrice(centsToDollars(1999)), { valid: true, cents: 1999 });

console.log(`\nPrice input helper tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} price input helper test(s) failed`);
