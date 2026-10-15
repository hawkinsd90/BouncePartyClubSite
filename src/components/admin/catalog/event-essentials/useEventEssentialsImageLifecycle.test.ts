// Lifecycle orchestration tests for the shared Event Essentials image lifecycle.
//
// The hook (useEventEssentialsImageLifecycle) is a thin React binding over the orchestration in
// eventEssentialsImageModel (closeWithCleanup, runImageSave, prepare = syncPendingImage + resolveSavedImageUrl),
// so this file drives those functions against a fake world that records every effect in order.
// `oracleSubmit` / `oracleClose` are verbatim copies of ProductForm / PackageForm's handleSubmit / handleClose /
// cleanupPendingUpload / deleteStorageFile as they stood before the extraction, with the same effects replaced by
// the same recorder. The oracle never calls the new module. Old and new are compared as complete ordered logs
// for both labels (product, package).

import {
  syncPendingImage,
  resolveSavedImageUrl,
  closeWithCleanup,
  runImageSave,
  deleteStorageFile as newDeleteStorageFile,
  type EntityLabel,
  type ImageAction,
  type ImageLifecycleDeps,
} from './eventEssentialsImageModel';
import type { UploadedImage } from './AdminImageUpload';

let passed = 0;
let failed = 0;
let compared = 0;

function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
function eq(label: string, a: unknown, b: unknown) {
  ok(`${label}\n   got      ${JSON.stringify(a)}\n   expected ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));
}

const BASE = 'https://x.supabase.co/storage/v1/object/public/event-essentials-media/';
const mk = (p: string) => ({ url: BASE + p, path: p }) as UploadedImage;
const A = mk('products/1/a.png');
const B = mk('products/1/b.png');
const OLD = BASE + 'products/1/old.png';

// ---- fake world ----
type RemoveMode = 'ok' | 'error' | 'throw';
interface WorldCfg {
  pending: UploadedImage | null; // what the uploader handle currently holds
  deleteNewOk: boolean; // result of handle.deleteNewlyUploaded()
  handlePresent: boolean;
  remove: RemoveMode;
}
function makeWorld(cfg: WorldCfg) {
  const log: string[] = [];
  let pending = cfg.pending;
  const handle = {
    deleteNewlyUploaded: async () => {
      log.push('handle.deleteNewlyUploaded');
      if (cfg.deleteNewOk) {
        pending = null;
        return true;
      }
      return false;
    },
    getUploadedImage: () => {
      log.push('handle.getUploadedImage');
      return pending;
    },
    commitUploadedImage: () => {
      log.push('handle.commit');
      pending = null;
    },
    resetToCurrentImage: () => {
      log.push('handle.reset');
    },
  };
  const parse = (url: string): string | null => {
    const i = url.indexOf('/event-essentials-media/');
    return i < 0 ? null : url.slice(i + '/event-essentials-media/'.length);
  };
  const removeObject = async (path: string) => {
    log.push(`storage.remove:${path}`);
    if (cfg.remove === 'throw') throw new Error('remove threw');
    return { error: cfg.remove === 'error' ? { message: 'remove failed' } : null };
  };
  return {
    log,
    getHandle: () => (cfg.handlePresent ? handle : null),
    setNew: (i: UploadedImage | null) => log.push(`setNew:${i?.url ?? null}`),
    setAction: (a: ImageAction) => log.push(`setAction:${a}`),
    warn: (m: string) => log.push(`warn:${m}`),
    logError: (...a: unknown[]) => log.push(`console.error:${a.map((x) => (x instanceof Error ? `Error(${x.message})` : String(x))).join('|')}`),
    removeObject,
    parse,
  };
}
type World = ReturnType<typeof makeWorld>;

// ---- oracles: verbatim old form code ----
function oracleForm(w: World, label: EntityLabel) {
  const ref = { get current() { return w.getHandle(); } };
  async function cleanupPendingUpload(): Promise<boolean> {
    const img = ref.current?.getUploadedImage();
    if (!img) {
      w.setNew(null);
      w.setAction('none');
      return true;
    }
    const deleted = await ref.current?.deleteNewlyUploaded();
    if (deleted) {
      w.setNew(null);
      w.setAction('none');
      return true;
    }
    const current = ref.current?.getUploadedImage();
    if (current) {
      w.setNew(current);
      w.setAction('upload');
    }
    w.warn('Could not delete the pending image. The form will stay open so you can retry.');
    return false;
  }
  async function deleteStorageFile(url: string): Promise<boolean> {
    const path = w.parse(url);
    if (!path) return true;
    try {
      const { error } = await w.removeObject(path);
      if (error) {
        w.logError('Failed to delete old storage file:', path, error.message);
        w.warn(`The ${label} was saved, but the old image file could not be deleted. Manual cleanup may be needed.`);
        return false;
      }
      return true;
    } catch (err) {
      w.logError('Failed to delete old storage file:', path, err);
      w.warn(`The ${label} was saved, but the old image file could not be deleted. Manual cleanup may be needed.`);
      return false;
    }
  }
  return { ref, cleanupPendingUpload, deleteStorageFile };
}

interface SubmitIn {
  imageAction: ImageAction;
  newUploadedImage: UploadedImage | null;
  formImageUrl: string | null;
  prevImageUrl: string | null;
  save: 'ok' | 'err' | 'err-empty' | 'throw-error' | 'throw-string';
  successThrows: boolean;
}
async function runSaveCall(w: World, s: SubmitIn, imageUrl: string | null) {
  w.log.push(`save:${imageUrl}`);
  if (s.save === 'throw-error') throw new Error('save threw');
  if (s.save === 'throw-string') throw 'boom';
  if (s.save === 'err') return { error: { message: 'rpc failed' } };
  if (s.save === 'err-empty') return { error: { message: '' } };
  return { error: null };
}

async function oracleSubmit(w: World, label: EntityLabel, s: SubmitIn): Promise<string> {
  const { ref, deleteStorageFile } = oracleForm(w, label);
  const prevImageUrl = { current: s.prevImageUrl };
  const fallback = label === 'product' ? 'Failed to save product' : 'Failed to save package';

  // Sync parent image state with child pending state before save.
  const childPending = ref.current?.getUploadedImage() ?? null;
  let effectiveAction = s.imageAction;
  let effectiveImage = s.newUploadedImage;
  if (childPending && (!s.newUploadedImage || s.newUploadedImage.url !== childPending.url)) {
    effectiveImage = childPending;
    effectiveAction = 'upload';
    w.setNew(childPending);
    w.setAction('upload');
  }

  let imageUrl = s.formImageUrl;
  if (effectiveAction === 'remove') {
    imageUrl = null;
  } else if (effectiveAction === 'upload' && effectiveImage) {
    imageUrl = effectiveImage.url;
  }

  w.log.push('setSaving:true');
  try {
    const { error } = await runSaveCall(w, s, imageUrl);
    if (error) {
      const msg = error.message || fallback;
      w.log.push(`failure:${msg}`);
      if (effectiveAction === 'upload') {
        const deleted = await ref.current?.deleteNewlyUploaded();
        if (deleted) {
          w.setNew(null);
          w.setAction('none');
          ref.current?.resetToCurrentImage();
        } else {
          const retained = ref.current?.getUploadedImage();
          if (retained) {
            w.setNew(retained);
            w.setAction('upload');
          }
        }
      }
      return 'returned';
    }
    if (effectiveAction === 'upload' && effectiveImage) {
      ref.current?.commitUploadedImage();
    }
    if (effectiveAction === 'upload' && effectiveImage && prevImageUrl.current) {
      await deleteStorageFile(prevImageUrl.current);
    }
    if (effectiveAction === 'remove' && prevImageUrl.current) {
      await deleteStorageFile(prevImageUrl.current);
    }
    w.log.push('success');
    if (s.successThrows) throw new Error('onSaved threw');
    return 'returned';
  } catch (err) {
    const msg = err instanceof Error ? err.message : fallback;
    w.log.push(`failure:${msg}`);
    if (effectiveAction === 'upload') {
      const deleted = await ref.current?.deleteNewlyUploaded();
      if (deleted) {
        w.setNew(null);
        w.setAction('none');
        ref.current?.resetToCurrentImage();
      } else {
        const retained = ref.current?.getUploadedImage();
        if (retained) {
          w.setNew(retained);
          w.setAction('upload');
        }
      }
    }
    return 'returned';
  } finally {
    w.log.push('setSaving:false');
  }
}

function depsOf(w: World, label: EntityLabel): ImageLifecycleDeps {
  return {
    getHandle: w.getHandle,
    setNewUploadedImage: w.setNew,
    setImageAction: w.setAction,
    warn: w.warn,
    logError: w.logError,
    removeStorageObject: w.removeObject,
    parseStoragePath: w.parse,
    entityLabel: label,
  };
}

// New: what the hook does (prepareImageForSave, then saveWithImage), against the same world.
async function newSubmit(w: World, label: EntityLabel, s: SubmitIn): Promise<string> {
  const fallback = label === 'product' ? 'Failed to save product' : 'Failed to save package';
  const deps = depsOf(w, label);
  const childPending = w.getHandle()?.getUploadedImage() ?? null;
  const synced = syncPendingImage({ childPending, newUploadedImage: s.newUploadedImage, imageAction: s.imageAction });
  if (synced.changed && childPending) {
    w.setNew(childPending);
    w.setAction('upload');
  }
  const imageUrl = resolveSavedImageUrl({ currentImageUrl: s.formImageUrl, effectiveAction: synced.effectiveAction, effectiveImage: synced.effectiveImage });
  await runImageSave(deps, {
    prepared: { effectiveAction: synced.effectiveAction, effectiveImage: synced.effectiveImage, imageUrl },
    previousImageUrl: s.prevImageUrl,
    fallbackMessage: fallback,
    setIsSaving: (v) => w.log.push(`setSaving:${v}`),
    saveEntity: () => runSaveCall(w, s, imageUrl),
    onFailure: (m) => w.log.push(`failure:${m}`),
    onSuccess: () => {
      w.log.push('success');
      if (s.successThrows) throw new Error('onSaved threw');
    },
  });
  return 'returned';
}

async function bothSubmit(label: EntityLabel, cfg: WorldCfg, s: SubmitIn, name: string) {
  const wo = makeWorld(cfg);
  const wn = makeWorld(cfg);
  const ro = await oracleSubmit(wo, label, s);
  const rn = await newSubmit(wn, label, s);
  compared++;
  eq(`${name} [${label}] log`, wn.log, wo.log);
  eq(`${name} [${label}] outcome`, rn, ro);
  return wn.log;
}

// close
async function oracleClose(w: World, label: EntityLabel, st: { closed: boolean; busy: boolean }): Promise<string[]> {
  const { cleanupPendingUpload } = oracleForm(w, label);
  const out: string[] = [];
  if (st.closed) return out;
  if (st.busy) return out;
  const cleaned = await cleanupPendingUpload();
  if (!cleaned) return out;
  st.closed = true;
  out.push('onClose');
  return out;
}
async function newClose(w: World, label: EntityLabel, st: { closed: boolean; busy: boolean }): Promise<string[]> {
  const out: string[] = [];
  await closeWithCleanup(depsOf(w, label), {
    isClosed: () => st.closed,
    isBusy: st.busy,
    markClosed: () => {
      st.closed = true;
    },
    onClose: () => out.push('onClose'),
  });
  return out;
}

const LABELS: EntityLabel[] = ['product', 'package'];
const DEFAULT_CFG: WorldCfg = { pending: null, deleteNewOk: true, handlePresent: true, remove: 'ok' };
const DEFAULT_S: SubmitIn = { imageAction: 'none', newUploadedImage: null, formImageUrl: OLD, prevImageUrl: OLD, save: 'ok', successThrows: false };

(async () => {
  // ---- named scenarios (A–H), both labels, asserting explicit expected logs ----
  for (const label of LABELS) {
    const warnOld = `warn:The ${label} was saved, but the old image file could not be deleted. Manual cleanup may be needed.`;

    // A. unchanged image
    let log = await bothSubmit(label, DEFAULT_CFG, DEFAULT_S, 'A unchanged');
    eq(`A unchanged exact [${label}]`, log, ['handle.getUploadedImage', 'setSaving:true', `save:${OLD}`, 'success', 'setSaving:false']);

    // B. create with uploaded image (no previous)
    log = await bothSubmit(label, { ...DEFAULT_CFG, pending: A }, { ...DEFAULT_S, imageAction: 'upload', newUploadedImage: A, formImageUrl: null, prevImageUrl: null }, 'B create');
    eq(`B create exact [${label}]`, log, ['handle.getUploadedImage', 'setSaving:true', `save:${A.url}`, 'handle.commit', 'success', 'setSaving:false']);

    // C. replace existing: save -> commit -> delete old
    log = await bothSubmit(label, { ...DEFAULT_CFG, pending: A }, { ...DEFAULT_S, imageAction: 'upload', newUploadedImage: A }, 'C replace');
    eq(`C replace exact [${label}]`, log, ['handle.getUploadedImage', 'setSaving:true', `save:${A.url}`, 'handle.commit', 'storage.remove:products/1/old.png', 'success', 'setSaving:false']);

    // D. remove existing: save null -> delete old
    log = await bothSubmit(label, DEFAULT_CFG, { ...DEFAULT_S, imageAction: 'remove' }, 'D remove');
    eq(`D remove exact [${label}]`, log, ['handle.getUploadedImage', 'setSaving:true', 'save:null', 'storage.remove:products/1/old.png', 'success', 'setSaving:false']);

    // E. returned error with uploaded replacement: rollback, old NOT deleted
    log = await bothSubmit(label, { ...DEFAULT_CFG, pending: A }, { ...DEFAULT_S, imageAction: 'upload', newUploadedImage: A, save: 'err' }, 'E save error');
    eq(`E save error exact [${label}]`, log, ['handle.getUploadedImage', 'setSaving:true', `save:${A.url}`, 'failure:rpc failed', 'handle.deleteNewlyUploaded', 'setNew:null', 'setAction:none', 'handle.reset', 'setSaving:false']);
    ok(`E old file never removed [${label}]`, !log.some((l) => l.startsWith('storage.remove')));

    // F. throw: same rollback contract
    log = await bothSubmit(label, { ...DEFAULT_CFG, pending: A }, { ...DEFAULT_S, imageAction: 'upload', newUploadedImage: A, save: 'throw-error' }, 'F save throws');
    eq(`F save throws exact [${label}]`, log, ['handle.getUploadedImage', 'setSaving:true', `save:${A.url}`, 'failure:save threw', 'handle.deleteNewlyUploaded', 'setNew:null', 'setAction:none', 'handle.reset', 'setSaving:false']);

    // G. rollback delete fails: pending retained, no reset, no false success
    log = await bothSubmit(label, { ...DEFAULT_CFG, pending: A, deleteNewOk: false }, { ...DEFAULT_S, imageAction: 'upload', newUploadedImage: A, save: 'err' }, 'G rollback delete fails');
    eq(`G rollback delete fails exact [${label}]`, log, ['handle.getUploadedImage', 'setSaving:true', `save:${A.url}`, 'failure:rpc failed', 'handle.deleteNewlyUploaded', 'handle.getUploadedImage', `setNew:${A.url}`, 'setAction:upload', 'setSaving:false']);
    ok(`G no reset, no success [${label}]`, !log.includes('handle.reset') && !log.includes('success'));

    // H. previous-file delete fails after save success: warning only, committed
    log = await bothSubmit(label, { ...DEFAULT_CFG, pending: A, remove: 'error' }, { ...DEFAULT_S, imageAction: 'upload', newUploadedImage: A }, 'H old delete error');
    eq(`H old delete error exact [${label}]`, log, ['handle.getUploadedImage', 'setSaving:true', `save:${A.url}`, 'handle.commit', 'storage.remove:products/1/old.png', 'console.error:Failed to delete old storage file:|products/1/old.png|remove failed', warnOld, 'success', 'setSaving:false']);
    log = await bothSubmit(label, { ...DEFAULT_CFG, pending: A, remove: 'throw' }, { ...DEFAULT_S, imageAction: 'upload', newUploadedImage: A }, 'H old delete throws');
    ok(`H old delete throws is warning only [${label}]`, log.includes(warnOld) && log.includes('success') && !log.some((l) => l.startsWith('failure:')));

    // non-storage previous URL: no removal, no warning
    log = await bothSubmit(label, { ...DEFAULT_CFG, pending: A }, { ...DEFAULT_S, imageAction: 'upload', newUploadedImage: A, prevImageUrl: 'https://other/a.png' }, 'non-storage previous');
    ok(`non-storage previous URL skipped [${label}]`, !log.some((l) => l.startsWith('storage.remove') || l.startsWith('warn')));

    // success callback throws after commit: catch path still rolls back (preserved quirk)
    log = await bothSubmit(label, { ...DEFAULT_CFG, pending: A }, { ...DEFAULT_S, imageAction: 'upload', newUploadedImage: A, successThrows: true }, 'onSaved throws');
    ok(`onSaved throws reaches rollback [${label}]`, log.includes('failure:onSaved threw'));
  }

  // fallback message per label
  for (const label of LABELS) {
    const log = await bothSubmit(label, DEFAULT_CFG, { ...DEFAULT_S, save: 'err-empty' }, 'fallback message');
    ok(`fallback text names the ${label}`, log.includes(`failure:Failed to save ${label}`));
    const log2 = await bothSubmit(label, DEFAULT_CFG, { ...DEFAULT_S, save: 'throw-string' }, 'non-Error throw');
    ok(`non-Error throw falls back to ${label} text`, log2.includes(`failure:Failed to save ${label}`));
  }

  // ---- deleteStorageFile return contract ----
  for (const label of LABELS) {
    let w = makeWorld({ ...DEFAULT_CFG, remove: 'ok' });
    eq(`delete ok returns true [${label}]`, [await newDeleteStorageFile(depsOf(w, label), OLD), w.log], [true, ['storage.remove:products/1/old.png']]);
    w = makeWorld({ ...DEFAULT_CFG, remove: 'ok' });
    eq(`delete non-storage url returns true without removing [${label}]`, [await newDeleteStorageFile(depsOf(w, label), 'https://other/a.png'), w.log], [true, []]);
    w = makeWorld({ ...DEFAULT_CFG, remove: 'error' });
    eq(`delete error returns false [${label}]`, await newDeleteStorageFile(depsOf(w, label), OLD), false);
    ok(`delete error logs the message string [${label}]`, w.log.includes('console.error:Failed to delete old storage file:|products/1/old.png|remove failed'));
    w = makeWorld({ ...DEFAULT_CFG, remove: 'throw' });
    eq(`delete throw returns false [${label}]`, await newDeleteStorageFile(depsOf(w, label), OLD), false);
    ok(`delete throw logs the Error object [${label}]`, w.log.includes('console.error:Failed to delete old storage file:|products/1/old.png|Error(remove threw)'));
  }

  // ---- close / cancel (I–L) ----
  for (const label of LABELS) {
    // I. cancel with no pending upload
    let w = makeWorld(DEFAULT_CFG);
    let st = { closed: false, busy: false };
    let out = await newClose(w, label, st);
    eq(`I clean close [${label}]`, [out, w.log], [['onClose'], ['handle.getUploadedImage', 'setNew:null', 'setAction:none']]);

    // J. cancel with pending upload: delete, then close
    w = makeWorld({ ...DEFAULT_CFG, pending: A });
    st = { closed: false, busy: false };
    out = await newClose(w, label, st);
    eq(`J close with pending [${label}]`, [out, w.log], [['onClose'], ['handle.getUploadedImage', 'handle.deleteNewlyUploaded', 'setNew:null', 'setAction:none']]);

    // K. cleanup failure: warn, do not close, pending remains
    w = makeWorld({ ...DEFAULT_CFG, pending: A, deleteNewOk: false });
    st = { closed: false, busy: false };
    out = await newClose(w, label, st);
    eq(`K close cleanup failure [${label}]`, [out, w.log, st.closed], [[], ['handle.getUploadedImage', 'handle.deleteNewlyUploaded', 'handle.getUploadedImage', `setNew:${A.url}`, 'setAction:upload', 'warn:Could not delete the pending image. The form will stay open so you can retry.'], false]);

    // L. double close / busy guard
    w = makeWorld({ ...DEFAULT_CFG, pending: A });
    st = { closed: false, busy: false };
    const first = await newClose(w, label, st);
    const logAfterFirst = w.log.length;
    const second = await newClose(w, label, st);
    eq(`L second close is a no-op [${label}]`, [first, second, w.log.length], [['onClose'], [], logAfterFirst]);
    w = makeWorld({ ...DEFAULT_CFG, pending: A });
    st = { closed: false, busy: true };
    out = await newClose(w, label, st);
    eq(`L busy close is a no-op [${label}]`, [out, w.log, st.closed], [[], [], false]);
  }

  // ---- close differential grid ----
  for (const label of LABELS) {
    for (const pending of [null, A]) {
      for (const deleteNewOk of [true, false]) {
        for (const handlePresent of [true, false]) {
          for (const closed of [false, true]) {
            for (const busy of [false, true]) {
              const cfg = { ...DEFAULT_CFG, pending, deleteNewOk, handlePresent };
              const wo = makeWorld(cfg);
              const wn = makeWorld(cfg);
              const so = { closed, busy };
              const sn = { closed, busy };
              const oo = await oracleClose(wo, label, so);
              const on = await newClose(wn, label, sn);
              compared++;
              eq(`close grid ${label}|${pending?.url}|${deleteNewOk}|${handlePresent}|${closed}|${busy}`, [on, wn.log, sn], [oo, wo.log, so]);
            }
          }
        }
      }
    }
  }

  // ---- submit differential grid ----
  const ACTIONS: ImageAction[] = ['none', 'upload', 'remove'];
  const NEWS: Array<UploadedImage | null> = [null, A];
  const CHILD: Array<UploadedImage | null> = [null, A, B];
  const CURRENT: Array<string | null> = [null, '', OLD, 'https://other/a.png'];
  const SAVES: SubmitIn['save'][] = ['ok', 'err', 'err-empty', 'throw-error', 'throw-string'];
  const REMOVES: RemoveMode[] = ['ok', 'error', 'throw'];
  for (const label of LABELS) {
    for (const imageAction of ACTIONS) {
      for (const newUploadedImage of NEWS) {
        for (const pending of CHILD) {
          for (const formImageUrl of CURRENT) {
            for (const prevImageUrl of CURRENT) {
              for (const save of SAVES) {
                for (const deleteNewOk of [true, false]) {
                  for (const remove of REMOVES) {
                    for (const successThrows of [false, true]) {
                      const cfg = { pending, deleteNewOk, handlePresent: true, remove };
                      await bothSubmit(label, cfg, { imageAction, newUploadedImage, formImageUrl, prevImageUrl, save, successThrows }, `grid ${imageAction}|${newUploadedImage?.url}|${pending?.url}|${formImageUrl}|${prevImageUrl}|${save}|${deleteNewOk}|${remove}|${successThrows}`);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    // handle missing entirely
    for (const imageAction of ACTIONS) {
      for (const save of SAVES) {
        await bothSubmit(label, { ...DEFAULT_CFG, handlePresent: false }, { ...DEFAULT_S, imageAction, newUploadedImage: imageAction === 'upload' ? A : null, save }, `no handle ${imageAction}|${save}`);
      }
    }
  }

  console.log(`Event Essentials image lifecycle tests: ${passed} passed, ${failed} failed (${compared} compared scenarios)`);
  if (failed > 0) throw new Error(`${failed} event essentials image lifecycle test(s) failed`);
})();
