// ---------------------------------------------------------------------------
// Shared currency validation (used by ProductForm and PackageForm)
// Pure helpers with no runtime dependencies. Re-exported from
// ./queries/products for existing importers.
// ---------------------------------------------------------------------------

const PRICE_REGEX = /^\d+(\.\d{1,2})?$/;
const MAX_PRICE_CENTS = 2147483647;

export type PriceParseResult =
  | { valid: true; cents: number | null }
  | { valid: false; reason: 'format' | 'too_large' };

export function parsePrice(dollars: string): PriceParseResult {
  const trimmed = dollars.trim();
  if (trimmed === '') return { valid: true, cents: null };
  if (!PRICE_REGEX.test(trimmed)) return { valid: false, reason: 'format' };
  const cents = Math.round(parseFloat(trimmed) * 100);
  if (!Number.isSafeInteger(cents)) return { valid: false, reason: 'too_large' };
  if (cents > MAX_PRICE_CENTS) return { valid: false, reason: 'too_large' };
  return { valid: true, cents };
}

export function priceErrorMessage(reason: 'format' | 'too_large'): string {
  return reason === 'too_large'
    ? 'Price is too large.'
    : 'Enter a valid dollar amount (e.g. 12, 12.50)';
}

export function centsToDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}
