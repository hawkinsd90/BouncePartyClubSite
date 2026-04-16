export const LOGO_URL =
  "https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/bounce-party-club-logo.png";

export const DEFAULT_PHONE = "(313) 889-3860";

export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
