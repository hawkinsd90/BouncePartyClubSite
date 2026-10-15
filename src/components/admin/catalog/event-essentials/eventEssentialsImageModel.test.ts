// Characterization tests for the pure Event Essentials image decisions (eventEssentialsImageModel.ts).
//
// The oracle functions are verbatim copies of the branch logic in ProductForm / PackageForm.handleSubmit as it
// stood before the extraction. The new module is never used inside an oracle.

import {
  syncPendingImage,
  resolveSavedImageUrl,
  planPostSaveCleanup,
  oldFileDeleteWarning,
  PENDING_DELETE_WARNING,
  type ImageAction,
} from './eventEssentialsImageModel';
import type { UploadedImage } from './AdminImageUpload';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
function eq(label: string, a: unknown, b: unknown) {
  ok(`${label} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
}

const A = { url: 'https://x/storage/v1/object/public/event-essentials-media/products/1/a.png', path: 'products/1/a.png' } as UploadedImage;
const B = { url: 'https://x/storage/v1/object/public/event-essentials-media/products/1/b.png', path: 'products/1/b.png' } as UploadedImage;
const ACTIONS: ImageAction[] = ['none', 'upload', 'remove'];
const IMAGES: Array<UploadedImage | null> = [null, A, B];
const URLS: Array<string | null> = [null, '', 'https://x/storage/v1/object/public/event-essentials-media/products/1/old.png', 'https://other/a.png'];

// ---- oracles (verbatim old branches) ----
function oracleSync(childPending: UploadedImage | null, newUploadedImage: UploadedImage | null, imageAction: ImageAction) {
  let effectiveAction = imageAction;
  let effectiveImage = newUploadedImage;
  let changed = false;
  if (childPending && (!newUploadedImage || newUploadedImage.url !== childPending.url)) {
    effectiveImage = childPending;
    effectiveAction = 'upload';
    changed = true;
  }
  return { effectiveAction, effectiveImage, changed };
}
function oracleUrl(formImageUrl: string | null, effectiveAction: ImageAction, effectiveImage: UploadedImage | null) {
  let imageUrl = formImageUrl;
  if (effectiveAction === 'remove') {
    imageUrl = null;
  } else if (effectiveAction === 'upload' && effectiveImage) {
    imageUrl = effectiveImage.url;
  }
  return imageUrl;
}
function oracleCleanup(effectiveAction: ImageAction, effectiveImage: UploadedImage | null, prev: string | null) {
  const steps: string[] = [];
  if (effectiveAction === 'upload' && effectiveImage) steps.push('commit');
  if (effectiveAction === 'upload' && effectiveImage && prev) steps.push('delete');
  if (effectiveAction === 'remove' && prev) steps.push('delete');
  return steps;
}

let n = 0;
for (const childPending of IMAGES) {
  for (const newUp of IMAGES) {
    for (const act of ACTIONS) {
      const o = oracleSync(childPending, newUp, act);
      const r = syncPendingImage({ childPending, newUploadedImage: newUp, imageAction: act });
      eq(`sync ${childPending?.url}|${newUp?.url}|${act}`, r, o);
      n++;
    }
  }
}
for (const cur of URLS) {
  for (const act of ACTIONS) {
    for (const img of IMAGES) {
      eq(`resolve ${cur}|${act}|${img?.url}`, resolveSavedImageUrl({ currentImageUrl: cur, effectiveAction: act, effectiveImage: img }), oracleUrl(cur, act, img));
      for (const prev of URLS) {
        const p = planPostSaveCleanup({ effectiveAction: act, effectiveImage: img, previousImageUrl: prev });
        const steps = [...(p.commit ? ['commit'] : []), ...(p.deletePrevious ? ['delete'] : [])];
        eq(`cleanup ${act}|${img?.url}|${prev}`, steps, oracleCleanup(act, img, prev));
        n++;
      }
    }
  }
}

// Named branch cases
eq('unchanged: existing URL kept', resolveSavedImageUrl({ currentImageUrl: 'u', effectiveAction: 'none', effectiveImage: null }), 'u');
eq('no image at all stays null', resolveSavedImageUrl({ currentImageUrl: null, effectiveAction: 'none', effectiveImage: null }), null);
eq('empty string is not normalized', resolveSavedImageUrl({ currentImageUrl: '', effectiveAction: 'none', effectiveImage: null }), '');
eq('remove wins over an existing URL', resolveSavedImageUrl({ currentImageUrl: 'u', effectiveAction: 'remove', effectiveImage: null }), null);
eq('remove wins even with a pending image', resolveSavedImageUrl({ currentImageUrl: 'u', effectiveAction: 'remove', effectiveImage: A }), null);
eq('upload replaces existing', resolveSavedImageUrl({ currentImageUrl: 'u', effectiveAction: 'upload', effectiveImage: A }), A.url);
eq('upload without an image keeps existing', resolveSavedImageUrl({ currentImageUrl: 'u', effectiveAction: 'upload', effectiveImage: null }), 'u');
eq('new upload with no current image', resolveSavedImageUrl({ currentImageUrl: null, effectiveAction: 'upload', effectiveImage: A }), A.url);
eq('child pending different from parent wins as upload', syncPendingImage({ childPending: B, newUploadedImage: A, imageAction: 'remove' }), { effectiveAction: 'upload', effectiveImage: B, changed: true });
eq('child pending same url keeps parent state', syncPendingImage({ childPending: A, newUploadedImage: A, imageAction: 'none' }).changed, false);
eq('no pending anywhere keeps remove', syncPendingImage({ childPending: null, newUploadedImage: null, imageAction: 'remove' }), { effectiveAction: 'remove', effectiveImage: null, changed: false });
eq('empty previous URL is never deleted', planPostSaveCleanup({ effectiveAction: 'upload', effectiveImage: A, previousImageUrl: '' }), { commit: true, deletePrevious: false });
eq('upload with no prior image commits only', planPostSaveCleanup({ effectiveAction: 'upload', effectiveImage: A, previousImageUrl: null }), { commit: true, deletePrevious: false });
eq('remove deletes previous without commit', planPostSaveCleanup({ effectiveAction: 'remove', effectiveImage: null, previousImageUrl: 'p' }), { commit: false, deletePrevious: true });
eq('none never cleans', planPostSaveCleanup({ effectiveAction: 'none', effectiveImage: null, previousImageUrl: 'p' }), { commit: false, deletePrevious: false });

// Warning copy
eq('product warning', oldFileDeleteWarning('product'), 'The product was saved, but the old image file could not be deleted. Manual cleanup may be needed.');
eq('package warning', oldFileDeleteWarning('package'), 'The package was saved, but the old image file could not be deleted. Manual cleanup may be needed.');
eq('pending warning', PENDING_DELETE_WARNING, 'Could not delete the pending image. The form will stay open so you can retry.');

console.log(`Event Essentials image model tests: ${passed} passed, ${failed} failed (${n} compared scenarios)`);
if (failed > 0) throw new Error(`${failed} event essentials image model test(s) failed`);
