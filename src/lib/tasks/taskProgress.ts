// What the crew sees while a slow task action runs (sending the customer a text, uploading photos): the button says what is happening,
// so a second tap is not mistaken for a stuck screen.
export type TaskBusyAction = 'en_route' | 'arrived' | 'drop_off' | 'pickup';

const WORKING_LABELS: Record<TaskBusyAction, string> = {
  en_route: 'Sending En Route notice...',
  arrived: 'Sending Arrived notice...',
  drop_off: 'Completing delivery...',
  pickup: 'Completing pickup...',
};

/** The line shown while an action is running; null when nothing is. Photo uploads take precedence only when no action is running. */
export function workingLabel(action: TaskBusyAction | null, uploadingImages: boolean): string | null {
  if (action) return WORKING_LABELS[action];
  return uploadingImages ? 'Uploading photos...' : null;
}

/** A button's own text: its normal label, or a short busy label when it is the action that is running. */
export function buttonLabel(normal: string, busyText: string, active: boolean): string {
  return active ? busyText : normal;
}
