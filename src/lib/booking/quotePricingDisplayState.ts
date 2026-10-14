import type { UnifiedQuoteTotals } from '../pricing/unifiedTotals';

export function getQuotePricingDisplayState(
  totals: UnifiedQuoteTotals | null,
  pricingConfigError: string | null,
): 'calculating' | 'error' | 'ready' {
  if (pricingConfigError) return 'error';
  if (!totals) return 'calculating';
  return 'ready';
}
