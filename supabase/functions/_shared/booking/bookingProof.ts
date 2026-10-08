// Booking setup proof (Payment Safety A2.3).
//
// A booking proof is the ONLY credential that lets an anonymous browser start the Stripe card-save (setup) session for a
// just-created booking request. It is:
//   * minted by the server (create-booking), inside the same database transaction that creates the order;
//   * random (256 bits) and stored only as a SHA-256 hash, so a database read never yields a usable credential;
//   * bound to exactly one order, short-lived (default 30 minutes) and single-use;
//   * a different credential from a portal link or an invoice link: it lives in its own table, is not accepted by
//     findValidOrderLink / proveOrderAccess, and a portal or invoice token is never accepted here.
//
// Consumption is claim -> create the Stripe session -> consume. A concurrent request cannot claim a claimed proof, a
// failed Stripe call releases the claim so the customer can retry, and a successful call consumes it for good.
//
// Import-free apart from Web Crypto, so it runs in Deno and Node.

export const BOOKING_PROOF_TTL_MINUTES = 30;
export const BOOKING_PROOF_CLAIM_STALE_SECONDS = 120;
export const BOOKING_TOKEN_PREFIX = "bk_";

const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function generateBookingToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return BOOKING_TOKEN_PREFIX + b64url(bytes);
}

export async function hashBookingToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function bookingProofExpiry(now: Date, ttlMinutes: number = BOOKING_PROOF_TTL_MINUTES): string {
  return new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
}

export function isWellFormedBookingToken(token: unknown): token is string {
  return typeof token === "string" && token.startsWith(BOOKING_TOKEN_PREFIX) && token.length >= 40 && token.length <= 80 && /^[A-Za-z0-9_-]+$/.test(token);
}

export type ClaimResult =
  | { ok: true; proofId: string; claimId: string }
  | { ok: false; reason: "invalid" | "expired" | "consumed" | "busy" | "error" };

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

type ProofRow = { id: string; claim_id: string | null; claimed_at: string | null };

// Read-only validation: does this token authorize THIS order right now? No state changes.
export async function checkBookingProof(
  db: Db,
  orderId: string,
  token: unknown,
  now: Date = new Date(),
): Promise<{ ok: true; row: ProofRow } | { ok: false; reason: "invalid" | "expired" | "consumed" | "error" }> {
  if (!isWellFormedBookingToken(token) || typeof orderId !== "string" || !orderId) return { ok: false, reason: "invalid" };
  const hash = await hashBookingToken(token);
  const { data: row, error } = await db
    .from("booking_setup_proofs")
    .select("id, order_id, expires_at, claim_id, claimed_at, consumed_at")
    .eq("token_hash", hash)
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) return { ok: false, reason: "error" };
  if (!row) return { ok: false, reason: "invalid" };
  if (row.consumed_at) return { ok: false, reason: "consumed" };
  if (!row.expires_at || new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, row };
}

export async function claimBookingProof(db: Db, orderId: string, token: unknown, now: Date = new Date()): Promise<ClaimResult> {
  const checked = await checkBookingProof(db, orderId, token, now);
  if (!checked.ok) return checked;
  const row = checked.row;

  const claimId = crypto.randomUUID();
  const claimedAt = now.toISOString();

  if (!row.claim_id) {
    const { data, error: upErr } = await db
      .from("booking_setup_proofs")
      .update({ claim_id: claimId, claimed_at: claimedAt })
      .eq("id", row.id)
      .is("claim_id", null)
      .is("consumed_at", null)
      .select("id");
    if (upErr) return { ok: false, reason: "error" };
    return Array.isArray(data) && data.length === 1 ? { ok: true, proofId: row.id, claimId } : { ok: false, reason: "busy" };
  }

  // Someone holds the claim. Only a claim that has gone stale (crashed request) can be taken over, and only by
  // compare-and-swap on the exact claim observed.
  const claimedMs = row.claimed_at ? new Date(row.claimed_at).getTime() : 0;
  if (now.getTime() - claimedMs < BOOKING_PROOF_CLAIM_STALE_SECONDS * 1000) return { ok: false, reason: "busy" };
  const { data, error: swapErr } = await db
    .from("booking_setup_proofs")
    .update({ claim_id: claimId, claimed_at: claimedAt })
    .eq("id", row.id)
    .eq("claim_id", row.claim_id)
    .is("consumed_at", null)
    .select("id");
  if (swapErr) return { ok: false, reason: "error" };
  return Array.isArray(data) && data.length === 1 ? { ok: true, proofId: row.id, claimId } : { ok: false, reason: "busy" };
}

export async function consumeBookingProof(db: Db, proofId: string, claimId: string, now: Date = new Date()): Promise<boolean> {
  const { data, error } = await db
    .from("booking_setup_proofs")
    .update({ consumed_at: now.toISOString() })
    .eq("id", proofId)
    .eq("claim_id", claimId)
    .is("consumed_at", null)
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

export async function releaseBookingProof(db: Db, proofId: string, claimId: string): Promise<void> {
  await db
    .from("booking_setup_proofs")
    .update({ claim_id: null, claimed_at: null })
    .eq("id", proofId)
    .eq("claim_id", claimId)
    .is("consumed_at", null);
}
