import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const TAG_ID = 'AW-18153233398';
const SCRIPT_ID = 'google-ads-gtag';

const BLOCKED_PREFIXES = ['/admin', '/crew', '/setup', '/invoice-preview', '/menu-preview'];

function isInternalRoute(pathname: string): boolean {
  return BLOCKED_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
}

export function GoogleAdsTag() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (isInternalRoute(pathname)) return;
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
      `gtag('config', '${TAG_ID}');`,
    ].join('\n');
    document.head.appendChild(inlineScript);
  }, [pathname]);

  return null;
}
