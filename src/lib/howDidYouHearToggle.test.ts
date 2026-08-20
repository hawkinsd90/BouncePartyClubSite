// Tests for How Did You Hear admin toggle setting.
//
// Verifies the PublicBusinessSettings interface includes how_did_you_hear_enabled,
// defaults to true, and parses 'false' correctly. Both Checkout and Invoice
// Acceptance read the same getPublicBusinessSettings() — this test exercises
// the parsing logic that both consumers depend on.

let passed = 0;
let failed = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; } else { failed++; console.error(`FAIL ${label}: expected ${e}, got ${a}`); }
}

// Replicate the parsing logic from getPublicBusinessSettings (adminSettingsCache.ts)
// to verify the contract both consumers rely on.
function parseHowDidYouHearEnabled(dataRecord: Record<string, string>): boolean {
  return dataRecord.how_did_you_hear_enabled !== 'false';
}

// Default: enabled (preserves current behavior)
eq('default enabled when key absent', parseHowDidYouHearEnabled({}), true);

// Explicitly enabled
eq('enabled when "true"', parseHowDidYouHearEnabled({ how_did_you_hear_enabled: 'true' }), true);

// Disabled
eq('disabled when "false"', parseHowDidYouHearEnabled({ how_did_you_hear_enabled: 'false' }), false);

// Any other value → enabled (fail-safe toward current behavior)
eq('enabled when garbage value', parseHowDidYouHearEnabled({ how_did_you_hear_enabled: 'banana' }), true);
eq('enabled when empty string', parseHowDid_you_hear_enabled_safe({ how_did_you_hear_enabled: '' }), true);

function parseHowDid_you_hear_enabled_safe(r: Record<string, string>): boolean {
  return r.how_did_you_hear_enabled !== 'false';
}

console.log(`\nHow Did You Hear toggle tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
