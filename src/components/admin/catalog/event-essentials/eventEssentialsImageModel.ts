// Event Essentials (Product + Package) image lifecycle, extracted verbatim from ProductForm / PackageForm.
//
// Pure decisions plus the async orchestration around the uploader handle. Every external effect (the uploader
// handle, state setters, storage removal, warnings, console logging) is injected, so this file has no React,
// Supabase or component runtime import. AdminImageUpload keeps the actual upload and pending-replacement logic;
// the forms keep their entity-specific save call. The hook (useEventEssentialsImageLifecycle) binds the real
// dependencies.
//
// Preserved quirks (do not "fix" here): the previous saved file is only deleted when its URL is truthy; a failed
// previous-file delete after a successful save is a warning, never a save failure; if the success callback throws
// after commit, the catch path still runs the rollback; a failed rollback or cleanup delete keeps the pending
// reference (no state clear); the product and package warnings differ only by their noun.

import type { UploadedImage } from './AdminImageUpload';

export type ImageAction = 'upload' | 'remove' | 'none';
export type EntityLabel = 'product' | 'package';

// The subset of AdminImageUploadHandle the lifecycle uses.
export interface ImageUploaderHandleLike {
  deleteNewlyUploaded: () => Promise<boolean>;
  getUploadedImage: () => UploadedImage | null;
  commitUploadedImage: () => void;
  resetToCurrentImage: () => void;
}

export interface PendingImageSelection {
  effectiveAction: ImageAction;
  effectiveImage: UploadedImage | null;
}

export interface PreparedImageSave extends PendingImageSelection {
  imageUrl: string | null;
}

// Parent state is synced with the child's pending upload before save. If the child retains a pending upload that
// the parent does not point at (e.g. after a failed remove), it is treated as the selected upload.
export function syncPendingImage(input: {
  childPending: UploadedImage | null;
  newUploadedImage: UploadedImage | null;
  imageAction: ImageAction;
}): PendingImageSelection & { changed: boolean } {
  const { childPending, newUploadedImage, imageAction } = input;
  if (childPending && (!newUploadedImage || newUploadedImage.url !== childPending.url)) {
    return { effectiveAction: 'upload', effectiveImage: childPending, changed: true };
  }
  return { effectiveAction: imageAction, effectiveImage: newUploadedImage, changed: false };
}

// Branch precedence: remove, then upload (only with an image), then the existing URL unchanged.
export function resolveSavedImageUrl(input: {
  currentImageUrl: string | null;
  effectiveAction: ImageAction;
  effectiveImage: UploadedImage | null;
}): string | null {
  const { currentImageUrl, effectiveAction, effectiveImage } = input;
  let imageUrl = currentImageUrl;
  if (effectiveAction === 'remove') {
    imageUrl = null;
  } else if (effectiveAction === 'upload' && effectiveImage) {
    imageUrl = effectiveImage.url;
  }
  return imageUrl;
}

// After a successful save: commit the pending upload, then delete the previous saved file when it was replaced or
// removed. Commit always happens first and deletion never happens before save success.
export function planPostSaveCleanup(input: {
  effectiveAction: ImageAction;
  effectiveImage: UploadedImage | null;
  previousImageUrl: string | null;
}): { commit: boolean; deletePrevious: boolean } {
  const { effectiveAction, effectiveImage, previousImageUrl } = input;
  const commit = effectiveAction === 'upload' && !!effectiveImage;
  const deletePrevious =
    (commit && !!previousImageUrl) || (effectiveAction === 'remove' && !!previousImageUrl);
  return { commit, deletePrevious };
}

export function oldFileDeleteWarning(entityLabel: EntityLabel): string {
  return `The ${entityLabel} was saved, but the old image file could not be deleted. Manual cleanup may be needed.`;
}

export const PENDING_DELETE_WARNING =
  'Could not delete the pending image. The form will stay open so you can retry.';

export interface ImageLifecycleDeps {
  // Re-read on every use, like `imageUploadRef.current`.
  getHandle: () => ImageUploaderHandleLike | null | undefined;
  setNewUploadedImage: (image: UploadedImage | null) => void;
  setImageAction: (action: ImageAction) => void;
  warn: (message: string) => void;
  logError: (...args: unknown[]) => void;
  // Bucket removal for a parsed path (the hook binds event-essentials-media).
  removeStorageObject: (path: string) => Promise<{ error: { message: string } | null }>;
  parseStoragePath: (url: string) => string | null;
  entityLabel: EntityLabel;
}

export async function cleanupPendingUpload(deps: ImageLifecycleDeps): Promise<boolean> {
  const img = deps.getHandle()?.getUploadedImage();
  if (!img) {
    deps.setNewUploadedImage(null);
    deps.setImageAction('none');
    return true;
  }
  const deleted = await deps.getHandle()?.deleteNewlyUploaded();
  if (deleted) {
    deps.setNewUploadedImage(null);
    deps.setImageAction('none');
    return true;
  }
  // Deletion failed — preserve child and parent pending state.
  // Re-affirm parent state points to the pending upload.
  const current = deps.getHandle()?.getUploadedImage();
  if (current) {
    deps.setNewUploadedImage(current);
    deps.setImageAction('upload');
  }
  deps.warn(PENDING_DELETE_WARNING);
  return false;
}

// Returns true when the form was closed. `markClosed` runs after a clean cleanup and before `onClose`.
export async function closeWithCleanup(
  deps: ImageLifecycleDeps,
  guards: { isClosed: () => boolean; isBusy: boolean; markClosed: () => void; onClose: () => void },
): Promise<void> {
  if (guards.isClosed()) return;
  if (guards.isBusy) return;
  const cleaned = await cleanupPendingUpload(deps);
  if (!cleaned) {
    // Keep modal open so cleanup can be retried.
    return;
  }
  guards.markClosed();
  guards.onClose();
}

export async function deleteStorageFile(deps: ImageLifecycleDeps, url: string): Promise<boolean> {
  const path = deps.parseStoragePath(url);
  if (!path) return true;
  try {
    const { error } = await deps.removeStorageObject(path);
    if (error) {
      deps.logError('Failed to delete old storage file:', path, error.message);
      deps.warn(oldFileDeleteWarning(deps.entityLabel));
      return false;
    }
    return true;
  } catch (err) {
    deps.logError('Failed to delete old storage file:', path, err);
    deps.warn(oldFileDeleteWarning(deps.entityLabel));
    return false;
  }
}

// Delete the newly uploaded file and reset the uploader to the persisted image. If the delete fails the pending
// reference is retained for retry.
export async function rollbackPendingUpload(deps: ImageLifecycleDeps): Promise<void> {
  const deleted = await deps.getHandle()?.deleteNewlyUploaded();
  if (deleted) {
    deps.setNewUploadedImage(null);
    deps.setImageAction('none');
    deps.getHandle()?.resetToCurrentImage();
  } else {
    // Cleanup failed — retain pending reference for retry.
    const retained = deps.getHandle()?.getUploadedImage();
    if (retained) {
      deps.setNewUploadedImage(retained);
      deps.setImageAction('upload');
    }
  }
}

export interface RunImageSaveArgs {
  prepared: PreparedImageSave;
  previousImageUrl: string | null;
  fallbackMessage: string;
  setIsSaving: (saving: boolean) => void;
  // The entity-specific save. Failures may be returned as `{ error }` or thrown.
  saveEntity: () => Promise<{ error: { message?: string } | null }>;
  // Called with the failure message before the rollback (the forms set rpcError and notify here).
  onFailure: (message: string) => void;
  // Called last on success (the forms notify and call onSaved here); a throw is handled like a save throw.
  onSuccess: () => void;
}

export async function runImageSave(deps: ImageLifecycleDeps, args: RunImageSaveArgs): Promise<void> {
  const { prepared, previousImageUrl } = args;
  const { effectiveAction, effectiveImage } = prepared;

  args.setIsSaving(true);

  try {
    const { error } = await args.saveEntity();

    if (error) {
      const msg = error.message || args.fallbackMessage;
      args.onFailure(msg);

      if (effectiveAction === 'upload') {
        await rollbackPendingUpload(deps);
      }
      return;
    }

    // Save succeeded — commit the pending upload only when that exact image was submitted.
    const plan = planPostSaveCleanup({ effectiveAction, effectiveImage, previousImageUrl });
    if (plan.commit) {
      deps.getHandle()?.commitUploadedImage();
    }

    // Delete prior saved image only after save success
    if (plan.deletePrevious && previousImageUrl) {
      await deleteStorageFile(deps, previousImageUrl);
    }

    args.onSuccess();
  } catch (err) {
    const msg = err instanceof Error ? err.message : args.fallbackMessage;
    args.onFailure(msg);

    if (effectiveAction === 'upload') {
      await rollbackPendingUpload(deps);
    }
  } finally {
    args.setIsSaving(false);
  }
}
