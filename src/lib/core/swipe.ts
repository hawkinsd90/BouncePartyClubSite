// WP-24: horizontal swipe on a photo viewer. A touch counts as a swipe only when it travels far enough sideways and is more sideways than
// vertical (so scrolling the page never flips the photo).

export const SWIPE_MIN_DISTANCE_PX = 48;

export type SwipeDirection = 'next' | 'prev' | null;

export function swipeDirection(startX: number, startY: number, endX: number, endY: number, minDistance: number = SWIPE_MIN_DISTANCE_PX): SwipeDirection {
  const dx = endX - startX;
  const dy = endY - startY;
  if (Math.abs(dx) < minDistance) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'next' : 'prev';
}

// Steps through `length` photos and wraps around; never returns an index outside the list (0 for an empty list).
export function stepIndex(current: number, direction: 'next' | 'prev', length: number): number {
  if (length <= 0) return 0;
  const safe = Math.min(Math.max(0, current), length - 1);
  return direction === 'next' ? (safe + 1) % length : (safe - 1 + length) % length;
}
