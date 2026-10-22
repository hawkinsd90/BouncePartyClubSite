// WP-21 (B14): one place for phone numbers.
//
// Numbers are STORED the way they were typed ("(313) 889-3860", "313-889-3860", "+1 313 889 3860"); nothing here rewrites stored data. Everything
// that reads a number (display, dial, text, compare) goes through these functions so they agree. US numbers only: ten digits, with an optional
// leading country code 1.

const PLACEHOLDERS = new Set(['no phone', 'n/a', 'na', 'none', 'unknown', '-']);

// The ten national digits, or null when the value is not a usable US number.
export function nationalDigits(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (PLACEHOLDERS.has(raw.trim().toLowerCase())) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? d : null;
}

export function isUsablePhone(raw: unknown): boolean {
  return nationalDigits(raw) !== null;
}

// (313) 889-3860, or '' when the value is not a usable number (callers show their own "no phone" text; this never invents one).
export function formatPhoneDisplay(raw: unknown): string {
  const d = nationalDigits(raw);
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : '';
}

export function toE164(raw: unknown): string | null {
  const d = nationalDigits(raw);
  return d ? `+1${d}` : null;
}

export function telHref(raw: unknown): string | null {
  const e = toE164(raw);
  return e ? `tel:${e}` : null;
}

export function smsHref(raw: unknown): string | null {
  const e = toE164(raw);
  return e ? `sms:${e}` : null;
}

export function samePhoneNumber(a: unknown, b: unknown): boolean {
  const x = nationalDigits(a);
  return x !== null && x === nationalDigits(b);
}

// For a text box as the person types or pastes: "+1 313 889 3860" and "1-313-889-3860" become (313) 889-3860 instead of being rejected or
// scrambled. A leading country code is dropped only when more than ten digits are present.
export function formatPhoneAsTyped(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('1')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
