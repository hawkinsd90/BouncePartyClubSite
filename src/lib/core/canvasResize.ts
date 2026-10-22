// WP-07 (B7): when a drawing canvas should be re-sized. Browsers fire `resize` when the URL bar hides, the keyboard opens or the
// device rotates; re-sizing a canvas clears it, so a resize that does not change its width must be ignored, and a real one must
// redraw what was already drawn.
export interface CanvasBox {
  width: number;
  height: number;
  ratio: number;
}

export function shouldResizeCanvas(previous: CanvasBox | null, next: CanvasBox): boolean {
  if (next.width <= 0 || next.height <= 0) return false;
  if (!previous) return true;
  // Only a change of width (or pixel ratio) matters: the canvas height is fixed by its CSS class.
  return Math.round(previous.width) !== Math.round(next.width) || previous.ratio !== next.ratio || Math.round(previous.height) !== Math.round(next.height);
}
