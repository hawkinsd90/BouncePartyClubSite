export const LOGO_URL =
  "https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/bounce-party-club-logo.png";

export const DEFAULT_PHONE = "(313) 889-3860";

export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  card: "Card",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  link: "Link",
  us_bank_account: "Bank Account",
  cash: "Cash",
  check: "Check",
};

export function formatPaymentMethodLabel(
  paymentMethodType: string | null,
  brand: string | null,
  last4: string | null
): string {
  if (!paymentMethodType) {
    return last4 ? `Card \u2022\u2022\u2022\u2022 ${last4}` : "Card on file";
  }
  if (paymentMethodType === "card") {
    if (brand && last4) {
      return `${brand.charAt(0).toUpperCase() + brand.slice(1)} \u2022\u2022\u2022\u2022 ${last4}`;
    }
    if (last4) return `Card \u2022\u2022\u2022\u2022 ${last4}`;
    if (brand) return `${brand.charAt(0).toUpperCase() + brand.slice(1)} card`;
    return "Card on file";
  }
  return PAYMENT_METHOD_LABELS[paymentMethodType] ?? paymentMethodType;
}
