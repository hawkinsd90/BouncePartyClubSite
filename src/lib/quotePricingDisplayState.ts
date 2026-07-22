import type { UnifiedQuoteTotals } from './unifiedTotals';

export function getQuotePricingDisplayState(
  totals: UnifiedQuoteTotals | null,
  pricingConfigError: string | null,
): 'calculating' | 'error' | 'ready' {
  if (pricingConfigError) return 'error';
  if (!totals) return 'calculating';
  return 'ready';
}
