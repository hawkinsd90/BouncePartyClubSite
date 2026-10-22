// The site header is ONE 64px row (WP-19/WP-20). The same number lives in src/index.css as --site-header-height; this file is the script
// side of it. Anything that sits under the header or scrolls a target into view clear of it uses these instead of its own literal.
export const HEADER_HEIGHT_PX = 64;

// How far below the top of the page a scrolled-to element should land: the header plus 1rem of air.
export const HEADER_OFFSET_PX = HEADER_HEIGHT_PX + 16;

// The same for CSS (scroll-margin-top).
export const SCROLL_MARGIN_CSS = 'calc(var(--site-header-height) + 1rem)';
