import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const TAG_ID = 'AW-18153233398';
const SCRIPT_ID = 'google-ads-gtag';

// Routes where the tag must never be injected.
// Note: once injected from a public route, the script remains in the DOM for
// the lifetime of the SPA session. This is intentional and safe — gtag does
// not hook into React Router, so no page_view or other events fire automatically
// on subsequent SPA navigation (including to /admin or /crew). send_page_view
// is set to false below, so even the initial config call emits no page_view.
// All tracking events must be fired explicitly via window.gtag() calls.
const BLOCKED_PREFIXES = ['/admin', '/crew', '/setup', '/invoice-preview', '/menu-preview'];

function isInternalRoute(pathname: string): boolean {
  return BLOCKED_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(prefix + '/')
  );
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
    inlineScript.textContent = [
      'window.dataLayer = window.dataLayer || [];',
      'function gtag(){dataLayer.push(arguments);}',
      "gtag('js', new Date());",
      // send_page_view: false — suppresses the automatic page_view fired by
      // gtag('config'). All page views and conversions must be fired manually.
      `gtag('config', '${TAG_ID}', { send_page_view: false });`,
    ].join('\n');
    document.head.appendChild(inlineScript);
  }, [pathname]);

  return null;
}
