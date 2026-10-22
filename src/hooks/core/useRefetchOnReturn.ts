import { useEffect, useRef } from 'react';

// Some tables are not published for realtime (sms_conversations is one), so a screen that shows them never hears about new rows.
// This reloads when the person comes back to the page (tab shown again, window focused, phone back online) and, when an interval is
// given, every so often while the page is visible. It never runs while the page is hidden.
export function useRefetchOnReturn(refetch: () => void, intervalMs?: number) {
  const latest = useRef(refetch);
  latest.current = refetch;

  useEffect(() => {
    const run = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      latest.current();
    };
    document.addEventListener('visibilitychange', run);
    window.addEventListener('focus', run);
    window.addEventListener('online', run);
    const timer = intervalMs && intervalMs > 0 ? window.setInterval(run, intervalMs) : null;
    return () => {
      document.removeEventListener('visibilitychange', run);
      window.removeEventListener('focus', run);
      window.removeEventListener('online', run);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [intervalMs]);
}
