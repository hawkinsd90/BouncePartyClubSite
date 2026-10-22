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
export function workingLabel(action: TaskBusyAction | null, uploadingImages: boolean, uploadCount?: number): string | null {
  if (action) return WORKING_LABELS[action];
  if (!uploadingImages) return null;
  return uploadCount && uploadCount > 0 ? uploadingLabel(uploadCount) : 'Uploading photos...';
}

/** A button's own text: its normal label, or a short busy label when it is the action that is running. */
export function buttonLabel(normal: string, busyText: string, active: boolean): string {
  return active ? busyText : normal;
}

// ---- photo upload states -------------------------------------------------------------------------------------------------------
// Started / in progress: the status line says how many photos are going up. Succeeded / partly skipped / failed: one inline notice that stays
// until dismissed (a blocking alert is gone the moment it is tapped). Retry: a failed batch keeps its files so one tap tries again without
// picking them again. Skipped files (too large, unsupported) cannot be retried as they are, so they offer no retry. The upload service
// gives no byte-level progress, so there is no percentage.
export function uploadingLabel(count: number): string {
  return count > 1 ? `Uploading ${count} photos... keep this screen open.` : 'Uploading photo... keep this screen open.';
}

export interface UploadNotice {
  tone: 'success' | 'warning' | 'error';
  message: string;
  /** Files kept for a one-tap retry (0 = nothing to retry). */
  retryCount: number;
}

/** The notice for a batch that finished without throwing; `message` is the existing summary text. */
export function noticeForResult(message: string, uploaded: number, skipped: number): UploadNotice {
  if (uploaded > 0 && skipped === 0) return { tone: 'success', message, retryCount: 0 };
  if (uploaded > 0) return { tone: 'warning', message, retryCount: 0 };
  return { tone: 'error', message, retryCount: 0 };
}

/** The notice for a batch that threw: the server discards a failed batch, so every file is still waiting and can be retried. */
export function noticeForFailure(message: string, fileCount: number): UploadNotice {
  return { tone: 'error', message: `${message} Nothing from this batch was saved.`, retryCount: fileCount };
}

/** Completion actions (Leaving, Complete) are off while photos are still going up, so the evidence check never runs against an unfinished upload. */
export function completionDisabled(flags: { processing: boolean; isToday: boolean; uploadingImages: boolean }): boolean {
  return flags.processing || !flags.isToday || flags.uploadingImages;
}
