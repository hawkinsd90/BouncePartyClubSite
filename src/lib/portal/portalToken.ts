// The single browser-side place that reads, carries and scrubs the customer portal credential.
//
// New links put the secret in the URL fragment: /customer-portal/<orderId>#t=<token>. Fragments are never sent in the
// request line or the Referer header, so servers, proxies and analytics do not see them. During the transition the
// legacy query form (?t=<token>) is still read. The browser never generates or derives a token; it only carries one the
// server issued.

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

function validToken(value: string | null | undefined): string | null {
  return value && TOKEN_RE.test(value) ? value : null;
}

// Fragment first (#t=... or #a=1&t=...), then the legacy ?t=... query parameter.
export function parsePortalToken(hash: string = '', search: string = ''): string | null {
  const fromHash = validToken(new URLSearchParams(hash.replace(/^#/, '')).get('t'));
  if (fromHash) return fromHash;
  return validToken(new URLSearchParams(search).get('t'));
}

export function readPortalToken(): string | null {
  if (typeof window === 'undefined') return null;
  return parsePortalToken(window.location.hash, window.location.search);
}

// True for a fragment that only carries a portal credential (so session/auth hash cleanup must leave it alone).
export function isPortalTokenHash(hash: string): boolean {
  return validToken(new URLSearchParams(hash.replace(/^#/, '')).get('t')) !== null;
}

// /customer-portal/<orderId>?<query>#t=<token>. `token` is only appended when it is a real token.
export function buildPortalPath(
  orderId: string,
  options: { token?: string | null; query?: Record<string, string | number | boolean | undefined | null> } = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const qs = params.toString();
  const token = validToken(options.token ?? null);
  return `/customer-portal/${orderId}${qs ? `?${qs}` : ''}${token ? `#t=${token}` : ''}`;
}

// Same destination for the current visitor: carries whatever proof they arrived with.
export function portalPathForCurrentVisitor(
  orderId: string,
  query?: Record<string, string | number | boolean | undefined | null>,
): string {
  return buildPortalPath(orderId, { token: readPortalToken(), query });
}

// A URL that is safe to store or send to a third party: no fragment, no ?t=, no short-link code.
export function redactCredentialsInUrl(href: string): string {
  const noFragment = href.split('#')[0];
  return noFragment
    .replace(/([?&])t=[^&]*/g, '$1t=[redacted]')
    .replace(/(\/i\/)[A-Za-z0-9]+/g, '$1[redacted]');
}

// Same for a bare pathname (analytics): /i/<shortCode> -> /i/[redacted].
export function redactCredentialsInPath(pathname: string): string {
  return pathname.replace(/(\/i\/)[A-Za-z0-9]+/g, '$1[redacted]');
}

// "#t=<token>" for appending to an in-app path, or "" when there is no usable token.
export function tokenFragment(token?: string | null): string {
  const t = validToken(token ?? null);
  return t ? `#t=${t}` : '';
}
