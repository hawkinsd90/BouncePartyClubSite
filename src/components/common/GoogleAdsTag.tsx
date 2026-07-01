import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const TAG_ID = 'AW-18153233398';
const SCRIPT_ID = 'google-ads-gtag';

// Routes where the tag must never be injected and events must never fire.
const BLOCKED_PREFIXES = ['/admin', '/crew', '/setup', '/invoice-preview', '/menu-preview'];

export function isInternalRoute(pathname: string): boolean {
  return BLOCKED_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(prefix + '/')
  );
}

/**
 * Safe wrapper for window.gtag event calls.
 * Guards against firing on admin/internal routes regardless of how the
 * caller ends up there (SPA navigation, direct visit, etc.).
 * No events are wired up yet — this is a future-use helper.
 */
export function trackGoogleAdsEvent(
  eventName: string,
  params?: Record<string, unknown>
): void {
  if (isInternalRoute(window.location.pathname)) return;
  if (typeof window.gtag !== 'function') return;
  window.gtag('event', eventName, params);
}

// Extend Window so TypeScript accepts window.gtag calls.
declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
    dataLayer: unknown[];
  }
}

export function GoogleAdsTag() {
  const { pathname } = useLocation();

  useEffect(() => {
    // Do not inject if this is the first route and it is internal.
    if (isInternalRoute(pathname)) return;
    // Prevent double-injection on subsequent public route visits.
    if (document.getElementById(SCRIPT_ID)) return;

    const loaderScript = document.createElement('script');
    loaderScript.id = SCRIPT_ID;
    loaderScript.async = true;
    loaderScript.src = `https://www.googletagmanager.com/gtag/js?id=${TAG_ID}`;
    document.head.appendChild(loaderScript);

    const inlineScript = document.createElement('script');
    inlineScript.id = `${SCRIPT_ID}-inline`;
    // send_page_view: false — all page views and conversions must be fired
    // manually via trackGoogleAdsEvent() after checking the current route.
    inlineScript.textContent = [
      'window.dataLayer = window.dataLayer || [];',
      'function gtag(){dataLayer.push(arguments);}',
      "gtag('js', new Date());",
      `gtag('config', '${TAG_ID}', { send_page_view: false });`,
    ].join('\n');
    document.head.appendChild(inlineScript);
  }, [pathname]);

  return null;
}
