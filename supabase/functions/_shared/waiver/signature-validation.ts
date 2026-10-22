// Shape checks for a customer's signed waiver (save-signature). Pure, so the rules are tested without a server.
//
// The signature is a legal record, so the function refuses anything that is not what the signing page produces: a PNG
// image of reasonable size, initials as short text keyed by waiver section, and bounded text fields.

export const MAX_SIGNATURE_BYTES = 1_500_000;
export const MIN_SIGNATURE_BYTES = 8;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DATA_URL_PREFIX = "data:image/png;base64,";
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export type SignatureImage = { ok: true; bytes: Uint8Array } | { ok: false };

export function parseSignatureDataUrl(dataUrl: unknown): SignatureImage {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(DATA_URL_PREFIX)) return { ok: false };
  const base64 = dataUrl.slice(DATA_URL_PREFIX.length);
  // Reject before decoding anything oversized: base64 is 4 characters per 3 bytes.
  if (base64.length === 0 || base64.length > Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 4 || base64.length % 4 !== 0 || !BASE64_RE.test(base64)) {
    return { ok: false };
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return { ok: false };
  }
  if (bytes.length < MIN_SIGNATURE_BYTES || bytes.length > MAX_SIGNATURE_BYTES) return { ok: false };
  for (let i = 0; i < PNG_MAGIC.length; i++) if (bytes[i] !== PNG_MAGIC[i]) return { ok: false };
  return { ok: true, bytes };
}

const text = (v: unknown, max: number, { required = false }: { required?: boolean } = {}): boolean => {
  if (v === undefined || v === null || v === "") return !required;
  return typeof v === "string" && v.length <= max;
};

export function validateInitials(initials: unknown): boolean {
  if (!initials || typeof initials !== "object" || Array.isArray(initials)) return false;
  const entries = Object.entries(initials as Record<string, unknown>);
  if (entries.length > 40) return false;
  return entries.every(([k, v]) => k.length > 0 && k.length <= 160 && typeof v === "string" && v.length <= 8);
}

// Returns the name of the first invalid field, or null when the payload is acceptable.
export function invalidSignatureField(b: Record<string, unknown>): string | null {
  if (!parseSignatureDataUrl(b.signatureDataUrl).ok) return "signatureDataUrl";
  if (!validateInitials(b.initialsData)) return "initialsData";
  if (!text(b.renterName, 200, { required: true })) return "renterName";
  if (!text(b.typedName, 200)) return "typedName";
  if (!text(b.renterEmail, 254, { required: true }) || !/^[^\s@]+@[^\s@]+$/.test(String(b.renterEmail))) return "renterEmail";
  if (!text(b.renterPhone, 40, { required: true })) return "renterPhone";
  if (typeof b.eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(b.eventDate)) return "eventDate";
  if (b.eventEndDate && (typeof b.eventEndDate !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(b.eventEndDate))) return "eventEndDate";
  for (const f of ["eventAddressLine1", "eventAddressLine2", "eventCity", "eventState", "eventZip", "homeAddressLine1", "homeAddressLine2", "homeCity", "homeState", "homeZip"]) {
    if (!text(b[f], 200)) return f;
  }
  if (!text(b.waiverVersion, 60)) return "waiverVersion";
  if (!text(b.waiverText, 200_000)) return "waiverText";
  if (!text(b.electronicConsentText, 5_000)) return "electronicConsentText";
  return null;
}
