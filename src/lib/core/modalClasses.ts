// WP-23 (B15): the one class string that keeps a dialog panel usable on a phone.
//
// A centered dialog whose panel is taller than the visible screen (small phone, landscape, on-screen keyboard) is cut off at the top and
// bottom with no way to scroll to its buttons. The panel gets a height cap in dynamic viewport units (so the mobile browser's moving URL
// bar is accounted for) and scrolls inside itself. Use it on the PANEL (the white box), not on the dark overlay.
// This is a shared constant, not a modal framework: each dialog keeps its own markup.
export const MODAL_PANEL_SCROLL = 'max-h-[90dvh] overflow-y-auto';
