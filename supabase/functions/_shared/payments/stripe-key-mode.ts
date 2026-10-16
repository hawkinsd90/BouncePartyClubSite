// Which Stripe mode a key belongs to, and whether a project may use it.
//
// Development must keep working with Stripe TEST mode (charges, refunds, saved test cards, invoices); it must never hold a LIVE
// key. This is deliberately not a block on Stripe in Development: only a live key outside Production is a problem.
// Pure (no Deno, no network); the value of a key is never returned or logged, only its mode.

import { PRODUCTION_PROJECT_REF, projectRefFromUrl } from "../notifications/outbound-guard.ts";

export type StripeKeyMode = "test" | "live" | "unknown";

// Secret (sk_), restricted (rk_) and publishable (pk_) keys all carry their mode in the second segment.
export function stripeKeyMode(key: unknown): StripeKeyMode {
  if (typeof key !== "string") return "unknown";
  const m = key.trim().match(/^(?:sk|rk|pk)_(test|live)_/);
  return m ? (m[1] as StripeKeyMode) : "unknown";
}

// null when the project may use the key; otherwise a reason that never contains the key.
export function stripeKeyProblem(supabaseUrl: unknown, key: unknown): string | null {
  const mode = stripeKeyMode(key);
  const ref = projectRefFromUrl(supabaseUrl);
  if (mode === "unknown") return "the Stripe key is not a recognizable test or live key";
  if (mode === "live" && ref !== PRODUCTION_PROJECT_REF) return "a LIVE Stripe key is configured outside the Production project";
  if (mode === "test" && ref === PRODUCTION_PROJECT_REF) return "a TEST Stripe key is configured in the Production project";
  return null;
}
