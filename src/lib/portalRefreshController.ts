// Secure live refresh for the Customer Portal (Payment Safety A2.2).
//
// The portal used to depend on Supabase Realtime subscriptions to the order tables, which only work while guests can read
// those tables directly. This controller replaces that with a periodic refetch through the secure portal endpoint:
//   - polls only while the page is visible (a hidden tab does no work);
//   - refetches as soon as the tab becomes visible or the window regains focus;
//   - never runs two reloads at once (a request that arrives mid-reload is folded into one follow-up);
//   - enforces a minimum gap between reloads so focus/visibility bursts cannot stack;
//   - stops completely on stop() (unmount).
// It is plain TypeScript with an injectable environment so it can be tested without a browser.

export interface RefreshEnv {
  now(): number;
  isVisible(): boolean;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  // Returns an unsubscribe function.
  onVisible(fn: () => void): () => void;
  onFocus(fn: () => void): () => void;
}

export interface PortalRefreshOptions {
  reload: () => Promise<unknown>;
  // Return true to skip refreshing (an upload or an approval is in progress).
  isSuppressed?: () => boolean;
  env: RefreshEnv;
  intervalMs?: number;
  minGapMs?: number;
}

export const PORTAL_POLL_INTERVAL_MS = 20_000;
export const PORTAL_MIN_RELOAD_GAP_MS = 3_000;

export interface PortalRefreshController {
  start(): void;
  stop(): void;
  // Refetch now, ignoring the minimum gap (used right after a successful customer action).
  refreshNow(): Promise<void>;
}

export function createPortalRefreshController(options: PortalRefreshOptions): PortalRefreshController {
  const { reload, env } = options;
  const intervalMs = options.intervalMs ?? PORTAL_POLL_INTERVAL_MS;
  const minGapMs = options.minGapMs ?? PORTAL_MIN_RELOAD_GAP_MS;

  let timer: unknown = null;
  let inFlight = false;
  let pending = false;
  let lastAt = -Infinity;
  let stopped = true;
  const unsubscribers: Array<() => void> = [];

  async function run(force: boolean): Promise<void> {
    if (stopped) return;
    if (options.isSuppressed?.()) return;
    if (inFlight) {
      pending = true;
      return;
    }
    if (!force && env.now() - lastAt < minGapMs) return;

    inFlight = true;
    pending = false;
    lastAt = env.now();
    try {
      await reload();
    } catch {
      // A failed refresh is retried by the next tick; it must never break the page.
    } finally {
      inFlight = false;
    }
    if (pending && !stopped) {
      pending = false;
      await run(true);
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      timer = env.setInterval(() => {
        if (env.isVisible()) void run(false);
      }, intervalMs);
      unsubscribers.push(
        env.onVisible(() => {
          if (env.isVisible()) void run(false);
        }),
        env.onFocus(() => {
          void run(false);
        }),
      );
    },
    stop() {
      stopped = true;
      pending = false;
      if (timer !== null) env.clearInterval(timer);
      timer = null;
      while (unsubscribers.length) unsubscribers.pop()?.();
    },
    refreshNow() {
      return run(true);
    },
  };
}

export function browserRefreshEnv(): RefreshEnv {
  return {
    now: () => Date.now(),
    isVisible: () => document.visibilityState === 'visible',
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
    onVisible: (fn) => {
      document.addEventListener('visibilitychange', fn);
      return () => document.removeEventListener('visibilitychange', fn);
    },
    onFocus: (fn) => {
      window.addEventListener('focus', fn);
      return () => window.removeEventListener('focus', fn);
    },
  };
}
