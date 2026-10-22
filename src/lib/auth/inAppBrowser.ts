// WP-24: Google refuses OAuth sign-in inside the small browsers embedded in other apps (Facebook, Instagram, TikTok, Snapchat, LINE, WeChat and
// Android/iOS web views) with a 403 "disallowed_useragent" page. Detecting them lets the sign-in page say so BEFORE the customer taps Google.
// A heuristic on purpose: it only decides whether to show a notice (never to block anything).

const IN_APP_TOKENS = [
  /FBAN|FBAV|FB_IAB|FBIOS/i, // Facebook / Messenger
  /Instagram/i,
  /Line\//i,
  /Snapchat/i,
  /MicroMessenger/i, // WeChat
  /musical_ly|BytedanceWebview|TikTok/i,
  /Twitter/i,
  /LinkedInApp/i,
  /GSA\//i, // Google Search app browser
];

export function isLikelyInAppBrowser(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').trim();
  if (!ua) return false;
  if (IN_APP_TOKENS.some((re) => re.test(ua))) return true;
  // Android web view: "; wv)" in the platform part.
  if (/Android/i.test(ua) && /;\s*wv\)/i.test(ua)) return true;
  // iOS web view: an iPhone/iPad user agent that has WebKit but no "Safari/" token (Safari, Chrome and Firefox on iOS all include it).
  if (/(iPhone|iPad|iPod)/i.test(ua) && /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua)) return true;
  return false;
}

export const IN_APP_BROWSER_NOTICE =
  'Google sign-in does not work inside this app\'s built-in browser. Open this page in Safari or Chrome (usually the "..." or share menu, then "Open in browser"), or sign in with your email and password instead.';
