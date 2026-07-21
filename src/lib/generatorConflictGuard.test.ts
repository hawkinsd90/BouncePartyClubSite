// Generator Workflow Unification — legacy detection helper tests.
// jiti runner, no React/Supabase.

import { hasLegacyGeneratorSelected } from './generatorConflictGuard';

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

function run() {
  // 1. has_generator true.
  ok('1 has_generator true', hasLegacyGeneratorSelected({ has_generator: true }) === true);

  // 2. has_generator false, no qty.
  ok('2 has_generator false', hasLegacyGeneratorSelected({ has_generator: false, generator_qty: 0 }) === false);

  // 3. generator_qty > 0 without has_generator.
  ok('3 generator_qty detected', hasLegacyGeneratorSelected({ has_generator: false, generator_qty: 2 }) === true);

  // 4. generator_qty = 0.
  ok('4 generator_qty 0', hasLegacyGeneratorSelected({ has_generator: false, generator_qty: 0 }) === false);

  // 5. Both false.
  ok('5 both false', hasLegacyGeneratorSelected({ has_generator: false, generator_qty: 0 }) === false);

  // 6. Both true.
  ok('6 both true', hasLegacyGeneratorSelected({ has_generator: true, generator_qty: 3 }) === true);
}

run();

console.log(`\nGenerator conflict guard tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
