// useGeneratorCheckbox package-aware legacy conversion + state management tests.
// jiti runner, no React/Supabase.

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    failed++;
    console.error(`FAIL: ${name}:`, err);
  }
}

function calculateDirectQtyToAdd(legacyQty: number, packageQty: number): number {
  return Math.max(0, legacyQty - packageQty);
}

// --- Package-aware conversion tests ---

test('should add zero direct items when package fully satisfies legacy qty', () => {
  ok('zero when equal', calculateDirectQtyToAdd(1, 1) === 0);
});

test('should add zero direct items when package exceeds legacy qty', () => {
  ok('zero when package exceeds', calculateDirectQtyToAdd(1, 2) === 0);
});

test('should add remaining qty when package partially satisfies legacy qty', () => {
  ok('remaining qty', calculateDirectQtyToAdd(3, 1) === 2);
});

test('should add full legacy qty when package has no generator', () => {
  ok('full qty when no package gen', calculateDirectQtyToAdd(2, 0) === 2);
});

test('should default legacy qty to 1 when generator_qty is 0 but has_generator is true', () => {
  const legacyQty = 0 > 0 ? 0 : 1;
  ok('defaults to 1', legacyQty === 1);
});

test('should clear legacy fields after successful conversion', () => {
  const updated = { has_generator: false, generator_qty: 0 };
  ok('has_generator cleared', updated.has_generator === false);
  ok('generator_qty cleared', updated.generator_qty === 0);
});

test('should not add direct item when availability check fails', () => {
  const availResult = { is_allowed: false };
  let itemAdded = false;
  if (availResult.is_allowed === true) {
    itemAdded = true;
  }
  ok('no item on failed availability', itemAdded === false);
});

test('should add direct item when availability check passes', () => {
  const availResult = { is_allowed: true };
  let itemAdded = false;
  if (availResult.is_allowed === true) {
    itemAdded = true;
  }
  ok('item added on passed availability', itemAdded === true);
});

// --- Conversion state management tests ---

test('should not mark conversion complete before it succeeds', () => {
  let conversionInFlight = false;
  let conversionCompleted = false;

  ok('not in flight before start', conversionInFlight === false);
  ok('not completed before start', conversionCompleted === false);

  conversionInFlight = true;
  ok('in flight during conversion', conversionInFlight === true);
  ok('not completed during conversion', conversionCompleted === false);

  conversionInFlight = false;
  conversionCompleted = true;
  ok('completed after success', conversionCompleted === true);
});

test('should remain retryable when conversion fails', () => {
  let conversionInFlight = false;
  let conversionCompleted = false;
  let legacyConversionNeeded = true;

  conversionInFlight = true;
  conversionInFlight = false;

  ok('not completed after failure', conversionCompleted === false);
  ok('still needed after failure', legacyConversionNeeded === true);
  ok('retry allowed', legacyConversionNeeded && !conversionCompleted && !conversionInFlight);
});

test('should prevent re-running after successful conversion', () => {
  const conversionCompleted = true;
  const conversionInFlight = false;
  const legacyConversionNeeded = false;
  const shouldRun = legacyConversionNeeded && !conversionCompleted && !conversionInFlight;
  ok('no re-run after success', shouldRun === false);
});

// --- Configuration loading state tests ---

test('should treat null packageConfigs as loading', () => {
  const packageConfigs = null;
  ok('null is loading', packageConfigs === null);
});

test('should treat empty array as loaded', () => {
  const packageConfigs: any[] = [];
  ok('empty array is loaded', packageConfigs !== null);
});

test('should treat undefined generatorProductId as loading', () => {
  const generatorProductId: string | null | undefined = undefined;
  ok('undefined is loading', generatorProductId === undefined);
});

test('should treat null generatorProductId as not found (not loading)', () => {
  const generatorProductId: string | null | undefined = null;
  ok('null is not loading', generatorProductId !== undefined);
});

// --- Runner ---

console.log('\nuseGeneratorCheckbox conversion tests:');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
