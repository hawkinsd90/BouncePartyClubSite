// Inbound SMS rules (twilio-webhook), kept pure so they are tested without a server.
//
// Phone numbers are stored the way they were typed ("(313) 889-3860", "313-889-3860", "+13138893860"), so a lookup cannot compare strings:
// it matches on the last ten digits, in order, with anything between the groups, and the caller then confirms the digits are equal.

export function digits10(phone: unknown): string {
  if (typeof phone !== "string") return "";
  const d = phone.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

// An ILIKE pattern that matches every common way of writing the same US number.
export function phoneLikePattern(d10: string): string {
  if (d10.length !== 10) return "";
  return `%${d10.slice(0, 3)}%${d10.slice(3, 6)}%${d10.slice(6)}%`;
}

export function samePhone(a: unknown, b: unknown): boolean {
  const x = digits10(a);
  return x !== "" && x === digits10(b);
}

// The words that opt a number out (the carrier-standard list) and ask for help.
export const STOP_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
export const START_KEYWORDS = ["START", "YES", "UNSTOP"];
export const HELP_KEYWORDS = ["HELP", "INFO"];

export type InboundKind = "stop" | "start" | "help" | "message";

// A keyword counts only when it is the whole message (so "please don't cancel my party" is an ordinary message).
export function classifyInbound(body: unknown): InboundKind {
  const word = typeof body === "string" ? body.trim().replace(/[.!\s]+$/g, "").toUpperCase() : "";
  if (STOP_KEYWORDS.includes(word)) return "stop";
  if (START_KEYWORDS.includes(word)) return "start";
  if (HELP_KEYWORDS.includes(word)) return "help";
  return "message";
}

export const AUTO_REPLY = "Thank you for your message! We've received it and will respond shortly. - Bounce Party Club";
export const HELP_REPLY = "Bounce Party Club: for help call (313) 889-3860. Message and data rates may apply. Reply STOP to unsubscribe.";

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function twiml(message?: string): string {
  return message
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Message>${escapeXml(message)}</Message>\n</Response>`
    : '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
}
