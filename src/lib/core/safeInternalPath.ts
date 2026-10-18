// Open-redirect guard for the `?next=` parameter (Step 3B: SEC-048).
//
// A navigation target taken from the URL must stay inside this site. The old check only required a leading "/" and no "//", but a
// backslash form such as "/\evil.example" passes that check and some routers/browsers treat it as an external, protocol-relative
// address. The target is accepted only if it has no backslash or control character, is not protocol-relative, and resolves to the same
// origin; the returned value is the normalised path + query + hash (never the raw input).
export function safeInternalPath(next: string | null | undefined, origin: string): string | null {
  if (typeof next !== 'string' || next.length === 0 || next.length > 2048) return null;
  if (!next.startsWith('/') || next.startsWith('//')) return null;
  for (let i = 0; i < next.length; i++) {
    const c = next.charCodeAt(i);
    if (c === 92 || c < 32 || c === 127) return null; // backslash or control character
  }
  try {
    const base = new URL(origin);
    const resolved = new URL(next, base);
    if (resolved.origin !== base.origin) return null;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return null;
  }
}
