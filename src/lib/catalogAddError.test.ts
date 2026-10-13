// Catalog add-error decision tests, split out of the former stageE4DefectFixes.test.ts. They call the real production helpers.

import { decideAddError } from './catalogAddError';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean) {
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
}

{
  const d = decideAddError(null, 'Insufficient inventory');
  ok('cat-30 banner receives error', d.bannerMessage === 'Insufficient inventory');
}

{
  const d = decideAddError(null, 'Insufficient inventory');
  ok('cat-31 toast receives error', d.showToast === true);
}

{
  const d1 = decideAddError('Insufficient inventory', 'Insufficient inventory');
  const d2 = decideAddError('Insufficient inventory', 'Insufficient inventory');
  ok('cat-32 first click toast', d1.showToast === true);
  ok('cat-32 second click toast', d2.showToast === true);
}

// 12. Second identical unavailable-package click still produces one new toast
{
  const d1 = decideAddError('Insufficient inventory', 'Insufficient inventory');
  const d2 = decideAddError('Insufficient inventory', 'Insufficient inventory');
  ok('cat-12 first toast', d1.showToast === true);
  ok('cat-12 second toast', d2.showToast === true);
}

console.log(`\nCatalog add-error decision tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
