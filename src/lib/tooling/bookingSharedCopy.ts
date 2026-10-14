// Server copies of the pure booking-pricing code (Payment Safety A2.3).
//
// The public booking is now priced on the server (supabase/functions/create-booking), which must use EXACTLY the same
// pure rules the Quote and Checkout pages use today (inflatable price breakdown, Event Essentials price resolution,
// setup fee, required deposit). Edge Functions cannot import from src/, so those modules are copied into
// supabase/functions/_shared/booking/ by this file's transform and a test fails if a copy drifts from its source.
//
// To refresh the copies after editing a source module:
//   node node_modules/jiti/bin/jiti.js src/lib/tooling/bookingSharedCopy.ts --write
//
// Only the browser-free parts are copied (no Supabase client, no Google Maps, no React).

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;
declare const process: { argv: string[] };

export interface SharedCopySpec {
  // Output file name under supabase/functions/_shared/booking/
  out: string;
  // Source file in the repo
  source: string;
  // Text transform applied to the source before the import rewrite
  slice?: (text: string) => string;
}

const IMPORT_MAP: Record<string, string> = {
  '../../types': './types.ts',
  '../booking/eventAddress': './eventAddress.ts',
  '../constants/statuses': './orderStatuses.ts',
  '../eventEssentials/eventEssentialsMoney': './eventEssentialsMoney.ts',
  '../eventEssentials/unifiedCart': './unifiedCartGuards.ts',
  '../pricing': './pricing.ts',
  '../pricing/orderMoney': './orderMoney.ts',
  './depositCalculation': './depositCalculation.ts',
  './eventEssentialsPricing': './eventEssentialsPricing.ts',
  './eventEssentialsPricingTypes': './eventEssentialsPricingTypes.ts',
  './orderMoney': './orderMoney.ts',
  './pricing/orderMoney': './orderMoney.ts',
  './pricing/travelFeeCalculator': './travelFeeFromDistance.ts',
  './setupFeeCalculation': './setupFeeCalculation.ts',
  './unifiedCart': './unifiedCartGuards.ts',
};

const between = (text: string, from: string, to?: string): string => {
  const a = text.indexOf(from);
  if (a < 0) throw new Error(`bookingSharedCopy: marker not found: ${from.slice(0, 50)}`);
  const b = to ? text.indexOf(to, a) : text.length;
  if (b < 0) throw new Error(`bookingSharedCopy: end marker not found: ${(to ?? '').slice(0, 50)}`);
  return text.slice(a, b);
};

export const SHARED_COPIES: SharedCopySpec[] = [
  { out: 'eventEssentialsPricingTypes.ts', source: 'src/lib/eventEssentials/eventEssentialsPricingTypes.ts' },
  { out: 'eventEssentialsPricing.ts', source: 'src/lib/eventEssentials/eventEssentialsPricing.ts' },
  { out: 'eventEssentialsCartRepricing.ts', source: 'src/lib/eventEssentials/eventEssentialsCartRepricing.ts' },
  { out: 'eventEssentialsCatalogResolver.ts', source: 'src/lib/eventEssentials/eventEssentialsCatalogResolver.ts' },
  { out: 'eventEssentialsMoney.ts', source: 'src/lib/eventEssentials/eventEssentialsMoney.ts' },
  { out: 'eeOrderItemAvailability.ts', source: 'src/lib/eventEssentials/eeOrderItemAvailability.ts' },
  { out: 'eventEssentialsOrderItems.ts', source: 'src/lib/eventEssentials/eventEssentialsOrderItems.ts' },
  { out: 'setupFeeCalculation.ts', source: 'src/lib/pricing/setupFeeCalculation.ts' },
  { out: 'orderMoney.ts', source: 'src/lib/pricing/orderMoney.ts' },
  // Only the status constants (the rest of the file is browser-side order helpers).
  { out: 'orderStatuses.ts', source: 'src/lib/constants/statuses.ts', slice: (t) => t.slice(0, t.indexOf('export const ORDER_STATUS_LABELS')) },
  { out: 'eventAddress.ts', source: 'src/lib/booking/eventAddress.ts' },
  { out: 'orderPricingState.ts', source: 'src/lib/pricing/orderPricingState.ts' },
  { out: 'orderChangePlanning.ts', source: 'src/lib/orders/orderChangePlanning.ts' },
  {
    out: 'orderPricingCalculation.ts',
    source: 'src/lib/pricing/orderPricingCalculation.ts',
    // The display summary type lives in a module that reads the browser Supabase client; the server needs only its shape.
    slice: (t) => t.replace("import type { OrderSummaryData } from '../orders/orderSummaryLoader';\n", '// deno-lint-ignore no-explicit-any\ntype OrderSummaryData = any;\n'),
  },
  { out: 'unifiedTotals.ts', source: 'src/lib/pricing/unifiedTotals.ts' },
  {
    out: 'depositCalculation.ts',
    source: 'src/lib/pricing/depositCalculation.ts',
    // The singleton row fetch reads the browser Supabase client; the server loads the row itself.
    slice: (t) => t.slice(0, t.indexOf('// ---------------------------------------------------------------------------\n// Singleton pricing-row fetch helper')),
  },
  {
    out: 'pricing.ts',
    source: 'src/lib/pricing.ts',
    // Drop the browser-only distance imports and re-exports; keep the pure price engine.
    slice: (t) =>
      t
        .replace(/import \{ calculateDistance as _calculateDistance[^\n]*\n/, '')
        .replace(/\/\/ Re-export for backward compatibility\nexport const calculateDistance = _calculateDistance;\nexport const calculateDrivingDistance = _calculateDrivingDistance;\n\n/, ''),
  },
  {
    out: 'travelFeeFromDistance.ts',
    source: 'src/lib/pricing/travelFeeCalculator.ts',
    slice: (t) => between(t, 'export interface TravelFeeFromDistanceInput', 'export async function calculateTravelFee('),
  },
  {
    out: 'unifiedCartGuards.ts',
    source: 'src/lib/eventEssentials/unifiedCart.ts',
    slice: (t) =>
      `import type {\n  UnifiedCartItem,\n  InflatableCartItem,\n  EventEssentialProductCartItem,\n  EventEssentialBundleCartItem,\n} from '../../types';\n\n` +
      between(t, 'export function isInflatableCartItem', 'function isStringArray'),
  },
  {
    out: 'types.ts',
    source: 'src/types/index.ts',
    slice: (t) =>
      between(t, 'export interface BundleComponentSnapshotItem', 'export interface ProductAvailabilityRequestItem') +
      between(t, "export type CartItemType = 'inflatable'", 'export interface InventoryProductWithPricing'),
  },
];

export function renderSharedCopy(spec: SharedCopySpec, sourceText: string): string {
  const normalized = sourceText.replace(/\r\n/g, '\n');
  const sliced = spec.slice ? spec.slice(normalized) : normalized;
  const rewritten = sliced.replace(/(from\s+)'(\.{1,2}\/[^']+)'/g, (_m, pre, spec2) => {
    const mapped = IMPORT_MAP[spec2];
    if (!mapped) throw new Error(`bookingSharedCopy: unmapped import '${spec2}' in ${spec.source}`);
    return `${pre}'${mapped}'`;
  });
  const header =
    // (A source that already carries its own directive does not get a second one: the second would be reported as unused.)
    (/(:|<|as)\s*any\b/.test(rewritten) && !/eslint-disable @typescript-eslint\/no-explicit-any/.test(rewritten) ? `/* eslint-disable @typescript-eslint/no-explicit-any */\n` : '') +
    `// GENERATED COPY of ${spec.source}${spec.slice ? ' (sliced)' : ''}. Do not edit here.\n` +
    `// Edit the source and run: node node_modules/jiti/bin/jiti.js src/lib/tooling/bookingSharedCopy.ts --write\n` +
    `// A test fails if this file differs from its source. Used by create-booking so the server prices exactly like the Quote.\n\n`;
  return header + rewritten.replace(/\s+$/, '') + '\n';
}

if (typeof process !== 'undefined' && process.argv.includes('--write')) {
  const fs = require('fs');
  fs.mkdirSync('supabase/functions/_shared/booking', { recursive: true });
  for (const spec of SHARED_COPIES) {
    const text = renderSharedCopy(spec, fs.readFileSync(spec.source, 'utf8'));
    fs.writeFileSync(`supabase/functions/_shared/booking/${spec.out}`, text);
    console.log('wrote', spec.out);
  }
}
