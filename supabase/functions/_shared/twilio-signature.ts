// Twilio request authentication for the inbound webhook and the delivery-status callback (Step 3B: SEC-025, SEC-026).
//
// Twilio signs every webhook it sends: X-Twilio-Signature = base64( HMAC-SHA1( authToken, fullUrl + for each POST parameter, sorted by
// name, name + value ) ). Both endpoints are public (verify_jwt = false: Twilio cannot send a Supabase JWT), so this signature is the
// only proof the request came from Twilio. A request without a valid signature must be rejected BEFORE any database access.
//
// This file has NO imports of its own beyond the sibling auth helper (types are structural) so it can be unit-tested outside Deno.
// The signing URL is the URL configured in the Twilio console. Behind the Supabase gateway the URL the function sees can differ
// (scheme, host), so a small set of candidate URLs is checked: the configured override (TWILIO_WEBHOOK_URL, optional), the project
// functions URL, and the request URL itself with http upgraded to https. A signature must match one of them.

import { timingSafeEqualStrings } from "./auth.ts";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export async function computeTwilioSignature(url: string, params: Record<string, string>, authToken: string): Promise<string> {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return toBase64(new Uint8Array(sig));
}

export function twilioCandidateUrls(opts: { requestUrl: string; supabaseUrl: string; functionName: string; override?: string }): string[] {
  const out = new Set<string>();
  if (opts.override) out.add(opts.override);
  if (opts.supabaseUrl) out.add(`${opts.supabaseUrl.replace(/\/+$/, "")}/functions/v1/${opts.functionName}`);
  out.add(opts.requestUrl);
  if (opts.requestUrl.startsWith("http://")) out.add("https://" + opts.requestUrl.slice("http://".length));
  return [...out];
}

export type TwilioVerdict = { ok: true } | { ok: false; reason: "missing_signature" | "missing_token" | "bad_signature" };

export async function verifyTwilioRequest(opts: {
  signatureHeader: string | null | undefined;
  authToken: string | null | undefined;
  params: Record<string, string>;
  candidateUrls: string[];
}): Promise<TwilioVerdict> {
  const provided = (opts.signatureHeader ?? "").trim();
  if (!provided) return { ok: false, reason: "missing_signature" };
  const token = (opts.authToken ?? "").trim();
  if (!token) return { ok: false, reason: "missing_token" };
  for (const url of opts.candidateUrls) {
    const expected = await computeTwilioSignature(url, opts.params, token);
    if (timingSafeEqualStrings(expected, provided)) return { ok: true };
  }
  return { ok: false, reason: "bad_signature" };
}

// Reads the form body into a plain object (Twilio posts application/x-www-form-urlencoded). Repeated names keep the last value, which is
// also how Twilio's own helper treats single-valued parameters.
export function formParams(form: { forEach(cb: (value: unknown, key: string) => void): void }): Record<string, string> {
  const out: Record<string, string> = {};
  form.forEach((value, key) => {
    out[key] = typeof value === "string" ? value : String(value);
  });
  return out;
}
