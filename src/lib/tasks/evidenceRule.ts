// NI-11 / WP-32 (B11): the required delivery / pickup photo, as the task screen sees it.
//
// The database enforces the rule (trigger on task_status). The screen asks first (get_task_evidence_state) so crew is told what to do
// BEFORE the customer is texted or the order moves on, and so an Admin can be offered the controlled override.

export interface EvidenceState {
  required: boolean;
  photo_count: number;
  overridden: boolean;
  can_complete: boolean;
}

export type EvidenceDecision =
  | { action: 'proceed' }
  | { action: 'blocked'; message: string }
  | { action: 'offer_override'; message: string };

export type EvidenceKind = 'delivery' | 'pickup';

export function parseEvidenceState(raw: unknown): EvidenceState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.required !== 'boolean' || typeof r.can_complete !== 'boolean') return null;
  return {
    required: r.required,
    photo_count: typeof r.photo_count === 'number' ? r.photo_count : 0,
    overridden: r.overridden === true,
    can_complete: r.can_complete,
  };
}

export function photoRequiredMessage(kind: EvidenceKind): string {
  return kind === 'pickup'
    ? 'A photo of the pickup is required before this pickup can be completed.\n\nTake at least one photo with the Photos button, then try again.'
    : 'A photo of the delivery is required before this delivery can be completed.\n\nTake at least one photo with the Photos button, then try again.';
}

// `state` is null when the lookup failed or the function does not exist yet: the screen then proceeds and the database decides.
export function decideEvidence(state: EvidenceState | null, kind: EvidenceKind, isAdmin: boolean): EvidenceDecision {
  if (!state || state.can_complete) return { action: 'proceed' };
  const message = photoRequiredMessage(kind);
  return isAdmin ? { action: 'offer_override', message } : { action: 'blocked', message };
}

export const MIN_OVERRIDE_REASON = 10;

export function overrideReasonProblem(reason: string): string | null {
  return reason.trim().length >= MIN_OVERRIDE_REASON ? null : `Please explain why (at least ${MIN_OVERRIDE_REASON} characters).`;
}

// The database refuses with a message that starts with EVIDENCE_REQUIRED (also its hint).
export function isEvidenceRequiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { message?: unknown; hint?: unknown };
  return (typeof e.message === 'string' && e.message.includes('EVIDENCE_REQUIRED')) || e.hint === 'EVIDENCE_REQUIRED';
}
