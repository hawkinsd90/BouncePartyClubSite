// Zoom steps of the print preview. A step is computed from the CURRENT zoom handed to a state updater, so a keyboard shortcut that was bound
// in an earlier render still moves from where the zoom is now (it used to move from the zoom of the render that created the listener).
export const ZOOM_LEVELS = [50, 75, 100, 125, 150] as const;
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

// One level up (direction 1) or down (-1); stays put at either end.
export function stepZoom(current: number, direction: 1 | -1): number {
  const index = ZOOM_LEVELS.indexOf(current as ZoomLevel);
  const next = index + direction;
  return index !== -1 && next >= 0 && next < ZOOM_LEVELS.length ? ZOOM_LEVELS[next] : current;
}
