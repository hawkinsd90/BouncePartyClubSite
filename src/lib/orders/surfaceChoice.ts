// WP-15 (B12): the "Setup Surface" choice on an order.
//
// Grass and sandbags only matter when there is an inflatable. An Event Essentials-only order has no surface (the server stores none), so the
// control is hidden for it. When the first inflatable is added to such an order the surface is NOT silently set to grass (that used to
// change the price without anyone choosing): the control asks, and saving waits for an answer.

export type SurfaceChoice = 'grass' | 'cement';
export type SurfaceControlState = 'legacy' | 'hidden' | 'choose' | SurfaceChoice;

interface SurfaceInput {
  hasInflatables: boolean;
  // null = no surface recorded; undefined = a screen that does not track it (the invoice builders use can_stake only)
  surface?: string | null;
  canStake?: boolean;
}

export function surfaceControlState({ hasInflatables, surface, canStake }: SurfaceInput): SurfaceControlState {
  if (!hasInflatables) return 'hidden';
  if (surface === 'grass' || surface === 'cement') return surface;
  if (surface === undefined) return canStake ? 'grass' : 'cement';
  return 'choose';
}

export function surfaceChoiceProblem({ hasInflatables, surface }: { hasInflatables: boolean; surface?: string | null }): string | null {
  if (!hasInflatables) return null;
  if (surface === 'grass' || surface === 'cement') return null;
  if (surface === undefined) return null;
  return 'Choose the setup surface (Grass or Sandbags) before saving. The order now includes an inflatable.';
}

// Staged order lines that count as an inflatable: a unit line that is not being removed.
export function hasActiveInflatable(items: ReadonlyArray<{ unit_id?: string | null; is_deleted?: boolean }>): boolean {
  return items.some((i) => !!i.unit_id && !i.is_deleted);
}
