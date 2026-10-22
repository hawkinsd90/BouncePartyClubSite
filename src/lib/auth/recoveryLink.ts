// WP-28 (B5): pure rules for the password-recovery link. No browser access here so every branch is testable.
//
// Supabase redirects a recovery link to the site with the proof in the URL hash (or a `?code=` for PKCE) and the Auth client
// clears that hash after a network call. Reading the live hash later therefore races with the client; the page instead reads a
// snapshot taken before the client starts, plus what the client itself reports (a session and the PASSWORD_RECOVERY event).

export const MIN_PASSWORD_LENGTH = 6;

export interface AuthLinkSnapshot {
  type: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  hasTokens: boolean;
  hasCode: boolean;
}

export const EMPTY_AUTH_LINK: AuthLinkSnapshot = { type: null, errorCode: null, errorDescription: null, hasTokens: false, hasCode: false };

function paramsOf(fragment: string): URLSearchParams {
  const raw = fragment.startsWith('#') || fragment.startsWith('?') ? fragment.slice(1) : fragment;
  return new URLSearchParams(raw);
}

export function parseAuthLink(hash: string | null | undefined, search: string | null | undefined): AuthLinkSnapshot {
  const h = paramsOf(hash ?? '');
  const q = paramsOf(search ?? '');
  const pick = (name: string) => h.get(name) ?? q.get(name);
  return {
    type: pick('type'),
    errorCode: pick('error_code'),
    errorDescription: pick('error_description'),
    hasTokens: !!h.get('access_token') && !!h.get('refresh_token'),
    hasCode: !!q.get('code'),
  };
}

export type RecoveryState = 'waiting' | 'ready' | 'expired' | 'invalid';

export interface RecoveryInputs {
  snapshot: AuthLinkSnapshot;
  // The client announced PASSWORD_RECOVERY (this page load, or earlier in this tab: remembered in sessionStorage).
  recoveryEvent: boolean;
  hasSession: boolean;
  // Waited long enough for the client to finish initializing.
  timedOut: boolean;
}

const EXPIRED_CODES = ['otp_expired', 'flow_state_expired', 'flow_state_not_found'];

export function decideRecoveryState(i: RecoveryInputs): RecoveryState {
  const { snapshot: s } = i;
  // A usable recovery session always wins, even when an old error is in the URL.
  if (i.hasSession && (i.recoveryEvent || s.type === 'recovery')) return 'ready';
  if (s.errorCode) return EXPIRED_CODES.includes(s.errorCode) || s.errorCode === 'access_denied' ? 'expired' : 'invalid';
  if (s.errorDescription) return 'expired';
  if (!i.timedOut) return 'waiting';
  // Nothing recoverable arrived. A link that carried a recovery proof but gave no session was used up or has expired.
  return s.type === 'recovery' || s.hasTokens || s.hasCode ? 'expired' : 'invalid';
}

export const RECOVERY_MESSAGES: Record<Exclude<RecoveryState, 'waiting' | 'ready'>, string> = {
  expired: 'This reset link has expired or was already used. Reset links work once. Please request a new one.',
  invalid: 'This page needs a reset link from your email. Please request a new one.',
};

export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password !== confirm) return 'Passwords do not match';
  return null;
}

// How long a remembered PASSWORD_RECOVERY stays valid in the tab.
export const RECOVERY_FLAG_TTL_MS = 60 * 60 * 1000;

export function isRecoveryFlagFresh(storedAt: string | null | undefined, now: number): boolean {
  const t = Number(storedAt);
  return Number.isFinite(t) && t > 0 && now - t >= 0 && now - t < RECOVERY_FLAG_TTL_MS;
}

// Whether the app should send the visitor to the reset form when it starts (or when the client announces PASSWORD_RECOVERY).
// OAuth sign-ins and portal `#t=` links carry other parameters and must never be redirected.
export function shouldOpenResetForm(i: { snapshot: AuthLinkSnapshot; recoveryPending: boolean; pathname: string }): boolean {
  if (i.pathname === '/reset-password') return false;
  if (i.snapshot.type === 'recovery') return true;
  return i.recoveryPending && (i.snapshot.hasTokens || i.snapshot.hasCode);
}
