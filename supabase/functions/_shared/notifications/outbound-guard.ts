// Environment guard for outbound customer / admin notifications (the SMS and email relays).
//
// WHY: the Development project holds real Production customer names, phone numbers and email addresses (the order data refresh
// copies them unchanged). Nothing sent from Development may ever reach those people, and nothing sent from Production may ever
// be redirected away from them.
//
// HOW: the decision is made from ONE fact the code cannot be misconfigured about: the project ref inside SUPABASE_URL, which the
// platform sets for every Edge Function.
//
//   Production ref   -> "live": the real recipient is used, untouched. There is no flag, secret or setting anywhere that can turn
//                       redirection on for this project.
//   Development ref  -> "redirect": the provider receives only the approved test destinations; the real recipient is kept for
//                       the logs, the message prefix and the email banner.
//   anything else    -> "block": an unknown project, a local stack, a missing or malformed URL, an invalid test-destination
//                       list. Nothing is sent. Failing closed is the safe default for an environment this code does not know.
//
// This module is pure (no Deno, no network, no environment reads) so every rule is unit-tested. It does NOT authorize anyone:
// callers run authorizeRelayCaller / the payload checks first; this only decides where an already-authorized message may go.

export const PRODUCTION_PROJECT_REF = "qaagfafagdpgzcijnfbw";
export const DEVELOPMENT_PROJECT_REF = "srxunxiytojjsuhcmzjg";

// The only destinations a Development message may reach. Constants on purpose: a configurable list is a list somebody can mis-set.
export const DEV_SMS_RECIPIENT = "+17343588854";
export const DEV_EMAIL_RECIPIENTS: readonly string[] = [
  "hawkinsd90@gmail.com",
  "deveehawk@gmail.com",
  "neverforgetthevibes@gmail.com",
];

export type OutboundChannel = "sms" | "email";
export type OutboundRouting = "live" | "redirect";

export type OutboundDecision =
  | { action: "send"; routing: OutboundRouting; channel: OutboundChannel; projectRef: string; originalRecipient: string; recipient: string }
  | { action: "block"; channel: OutboundChannel; projectRef: string | null; originalRecipient: string; reason: string };

// "https://<ref>.supabase.co" -> "<ref>". Anything else (other host, scheme, port, userinfo, path) -> null, which blocks.
export function projectRefFromUrl(supabaseUrl: unknown): string | null {
  if (typeof supabaseUrl !== "string") return null;
  let url: URL;
  try {
    url = new URL(supabaseUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const m = url.hostname.match(/^([a-z]{20})\.supabase\.co$/);
  return m ? m[1] : null;
}

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

// Problems with the Development destinations themselves. Empty when they are usable. Checked on every redirect decision.
export function testDestinationProblems(
  sms: string = DEV_SMS_RECIPIENT,
  emails: readonly string[] = DEV_EMAIL_RECIPIENTS,
): string[] {
  const problems: string[] = [];
  if (!E164.test(sms)) problems.push("the Development SMS destination is not a valid E.164 number");
  if (emails.length === 0) problems.push("the Development email destination list is empty");
  if (emails.some((e) => !EMAIL.test(e))) problems.push("a Development email destination is not a valid address");
  if (new Set(emails.map((e) => e.toLowerCase())).size !== emails.length) problems.push("the Development email destination list has duplicates");
  return problems;
}

// FNV-1a, 32 bit. Deterministic, so the same original recipient always lands in the same test inbox.
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function pickDevEmailRecipient(originalRecipient: string, emails: readonly string[] = DEV_EMAIL_RECIPIENTS): string {
  return emails[fnv1a(originalRecipient.trim().toLowerCase()) % emails.length];
}

export function decideOutbound(channel: OutboundChannel, supabaseUrl: unknown, originalRecipient: unknown): OutboundDecision {
  const original = typeof originalRecipient === "string" ? originalRecipient : "";
  if (channel !== "sms" && channel !== "email") {
    return { action: "block", channel, projectRef: null, originalRecipient: original, reason: "unknown notification channel" };
  }
  const ref = projectRefFromUrl(supabaseUrl);
  if (!ref) {
    return { action: "block", channel, projectRef: null, originalRecipient: original, reason: "the environment could not be identified; nothing is sent" };
  }
  if (ref === PRODUCTION_PROJECT_REF) {
    return { action: "send", routing: "live", channel, projectRef: ref, originalRecipient: original, recipient: original };
  }
  if (ref !== DEVELOPMENT_PROJECT_REF) {
    return { action: "block", channel, projectRef: ref, originalRecipient: original, reason: "unrecognized project; nothing is sent" };
  }
  const problems = testDestinationProblems();
  if (problems.length > 0) {
    return { action: "block", channel, projectRef: ref, originalRecipient: original, reason: `unsafe test-destination configuration: ${problems.join("; ")}` };
  }
  const recipient = channel === "sms" ? DEV_SMS_RECIPIENT : pickDevEmailRecipient(original || "unknown");
  return { action: "send", routing: "redirect", channel, projectRef: ref, originalRecipient: original, recipient };
}

// ---------------------------------------------------------------------------------------------------------------------
// Presentation of a redirected message. Live messages are never altered.
// ---------------------------------------------------------------------------------------------------------------------
const stripLineBreaks = (s: string) => s.replace(/[\r\n]+/g, " ");

export function redirectedSmsBody(decision: OutboundDecision, body: string): string {
  if (decision.action !== "send" || decision.routing !== "redirect") return body;
  return `[DEV -> ${stripLineBreaks(decision.originalRecipient) || "unknown"}] ${body}`;
}

export function redirectedEmailSubject(decision: OutboundDecision, subject: string): string {
  if (decision.action !== "send" || decision.routing !== "redirect") return subject;
  return `[DEV -> ${stripLineBreaks(decision.originalRecipient) || "unknown"}] ${subject}`;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function redirectedEmailBanner(decision: OutboundDecision): { html: string; text: string } {
  if (decision.action !== "send" || decision.routing !== "redirect") return { html: "", text: "" };
  const who = decision.originalRecipient || "unknown";
  return {
    html: `<div style="background:#fff3cd;border:1px solid #ffe69c;color:#664d03;padding:10px 14px;margin:0 0 12px 0;font:14px Arial,sans-serif">DEVELOPMENT TEST MESSAGE. In production this would be delivered to <strong>${escapeHtml(who)}</strong>. It was redirected here and was not sent to them.</div>`,
    text: `DEVELOPMENT TEST MESSAGE. In production this would be delivered to ${stripLineBreaks(who)}. It was redirected here and was not sent to them.\n\n`,
  };
}

// Puts the banner at the top of an email body (after <body ...> when present).
export function withEmailBanner(decision: OutboundDecision, html: string | undefined, text: string | undefined): { html?: string; text?: string } {
  const banner = redirectedEmailBanner(decision);
  if (!banner.html) return { html, text };
  let outHtml = html;
  if (html) {
    const body = html.match(/<body[^>]*>/i);
    outHtml = body ? html.replace(body[0], `${body[0]}${banner.html}`) : `${banner.html}${html}`;
  }
  return { html: outHtml, text: text ? `${banner.text}${text}` : text };
}
