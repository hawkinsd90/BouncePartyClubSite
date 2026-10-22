// WP-28 (B5): browser side of the recovery link. This module must be imported BEFORE the Supabase client is created
// (src/lib/supabase.ts does so) because the client clears the URL hash after it verifies the link.
import { EMPTY_AUTH_LINK, isRecoveryFlagFresh, parseAuthLink, type AuthLinkSnapshot } from './recoveryLink';

const FLAG_KEY = 'bpc-password-recovery';

function takeSnapshot(): AuthLinkSnapshot {
  try {
    if (typeof window === 'undefined') return EMPTY_AUTH_LINK;
    return parseAuthLink(window.location.hash, window.location.search);
  } catch {
    return EMPTY_AUTH_LINK;
  }
}

// Taken once, when this module first loads, before the client can touch the URL.
export const initialAuthLink: AuthLinkSnapshot = takeSnapshot();

const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

let memoryFlag: number | null = null;

export function markRecoveryPending(now: number = Date.now()) {
  memoryFlag = now;
  try {
    storage()?.setItem(FLAG_KEY, String(now));
  } catch {
    // storage blocked: the in-memory flag still covers this page load
  }
  listeners.forEach((fn) => fn());
}

export function isRecoveryPending(now: number = Date.now()): boolean {
  let stored: string | null = null;
  try {
    stored = storage()?.getItem(FLAG_KEY) ?? null;
  } catch {
    stored = null;
  }
  return isRecoveryFlagFresh(stored, now) || (memoryFlag !== null && isRecoveryFlagFresh(String(memoryFlag), now));
}

export function clearRecoveryPending() {
  memoryFlag = null;
  try {
    storage()?.removeItem(FLAG_KEY);
  } catch {
    // ignore
  }
}

export function subscribeRecovery(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Registered by supabase.ts right after the client is created, so the event cannot be missed even if it fires before any
// React component has mounted.
export function installRecoveryTracking(auth: { onAuthStateChange: (cb: (event: string) => void) => unknown }) {
  auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') markRecoveryPending();
  });
}
