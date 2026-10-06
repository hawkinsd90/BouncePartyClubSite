// Differential tests for the crew task photo pipeline (taskPhotoUpload.ts).
//
// `oracleHandler` is a verbatim copy of the old TaskDetailModal.handleImageUpload onchange body
// (after the file picker and ensureTaskStatus), including its summary alerts and catch projection.
// Only I/O seams differ: the compressor, the clock and the Supabase client are fakes, and the
// `refresh()` / `showAlert()` calls are recorded. The oracle never calls the new module. The recorded
// operation log (storage upload/getPublicUrl, task_status read/write, refresh, alert) is compared in
// full. The new-side `driver` is a copy of the modal's adoption code (refresh then alert, same catch).

import { isHeicFile, compressImage, uploadTaskPhotos, buildPhotoUploadSummary } from './taskPhotoUpload';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.every((k) => same(ra[k], rb[k]));
  }
  return false;
}

function eq(label: string, actual: unknown, expected: unknown) {
  if (same(actual, expected)) { passed++; } else {
    failed++;
    console.error(`FAIL ${label}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// The pipeline is chatty by design; keep test output readable.
const realLog = console.log; const realWarn = console.warn; const realError = console.error;
async function quietAsync<T>(fn: () => Promise<T>): Promise<T> {
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = realLog; console.warn = realWarn; console.error = realError; }
}

const MB = 1024 * 1024;
const mkFile = (name: string, type: string, size: number): File => ({ name, type, size } as unknown as File);

// ---- Fakes ----
interface FakeSpec {
  // name used for upload -> response
  upload: (name: string) => { data: any; error: any };
  existing: any;          // task_status column value read back ({[col]: [...]}) or null
  readError?: any;
  updateError?: any;
}
function fakeClient(spec: FakeSpec) {
  const ops: any[] = [];
  const client: any = {
    storage: {
      from(bucket: string) {
        return {
          upload(name: string, blob: any, opts: any) {
            ops.push(['upload', bucket, name, blob && blob.tag ? blob.tag : 'original', opts]);
            return Promise.resolve(spec.upload(name));
          },
          getPublicUrl(path: string) {
            ops.push(['getPublicUrl', bucket, path]);
            return { data: { publicUrl: `https://cdn.test/${bucket}/${path}` } };
          },
        };
      },
    },
    from(table: string) {
      ops.push(['from', table]);
      let mode: 'select' | 'update' = 'select';
      const b: any = {
        select(col: string) { ops.push(['select', col]); mode = 'select'; return b; },
        update(payload: any) { ops.push(['update', payload]); mode = 'update'; return b; },
        eq(k: string, v: any) {
          ops.push(['eq', k, v]);
          if (mode === 'update') return Promise.resolve({ error: spec.updateError ?? null });
          return b;
        },
        maybeSingle() {
          ops.push(['maybeSingle']);
          return Promise.resolve({ data: spec.existing, error: spec.readError ?? null });
        },
      };
      return b;
    },
  };
  return { client, ops };
}

// Compressor fake: result decided by a table keyed on file name.
type CompressMode = 'ok' | 'fail';
function fakeCompress(modes: Record<string, CompressMode>, defaultMode: CompressMode = 'ok') {
  return async (file: File): Promise<Blob | null> => {
    const m = modes[file.name] ?? defaultMode;
    if (m === 'fail') return null;
    return { size: Math.max(1, Math.floor(file.size / 3)), tag: `c:${file.name}` } as unknown as Blob;
  };
}

// ---- ORACLE: verbatim old onchange body ----
function isHeicFileOld(file: File): boolean {
  const mimeHeic = ['image/heic', 'image/heif'];
  if (mimeHeic.includes(file.type.toLowerCase())) return true;
  return /\.hei[cf]$/i.test(file.name);
}

async function oracleHandler(
  files: File[], isDamage: boolean | undefined, task: any, taskStatusId: string,
  supabase: any, compressImage: (f: File) => Promise<Blob | null>, now: () => number, rec: any[],
) {
  const BUCKET_LIMIT_BYTES = 10 * 1024 * 1024;
  const refresh = () => { rec.push(['refresh']); };
  const showAlert = (m: string) => { rec.push(['alert', m]); };
  const uploadedUrls: string[] = [];
  const skippedHeic: string[] = [];
  const skippedLarge: string[] = [];

  try {
    for (const file of files) {
      const heic = isHeicFileOld(file);
      const effectiveType = file.type || (heic ? 'image/heic' : 'unknown');
      void effectiveType;

      let uploadBlob: Blob = file;
      let uploadName = `${task.orderId}-${task.type}-${now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      if (heic) {
        if (file.size <= BUCKET_LIMIT_BYTES) {
          // as-is
        } else {
          skippedHeic.push(file.name);
          continue;
        }
      } else {
        const compressed = await compressImage(file);
        if (compressed) {
          uploadBlob = compressed;
          uploadName = uploadName.replace(/\.[^.]+$/, '') + '.jpg';
        } else {
          if (file.size > BUCKET_LIMIT_BYTES) {
            skippedLarge.push(file.name);
            continue;
          }
        }
      }

      const { data, error } = await supabase.storage
        .from('public-assets')
        .upload(uploadName, uploadBlob, { cacheControl: '3600', upsert: false });

      if (error) {
        if (error.message?.toLowerCase().includes('size') || error.message?.toLowerCase().includes('maximum')) {
          skippedLarge.push(file.name);
          continue;
        }
        throw error;
      }

      const { data: urlData } = supabase.storage.from('public-assets').getPublicUrl(data.path);
      uploadedUrls.push(urlData.publicUrl);
    }

    if (uploadedUrls.length > 0) {
      const col = isDamage ? 'damage_images' : 'delivery_images';
      const { data: cur, error: fetchErr } = await supabase
        .from('task_status').select(col).eq('id', taskStatusId).maybeSingle();
      if (fetchErr) throw fetchErr;
      const merged = [...((cur as any)?.[col] || []), ...uploadedUrls];
      const { error: updErr } = await supabase.from('task_status').update({ [col]: merged }).eq('id', taskStatusId);
      if (updErr) throw updErr;
      refresh();
    }

    const totalSkipped = skippedHeic.length + skippedLarge.length;

    if (uploadedUrls.length === 0 && totalSkipped > 0) {
      if (skippedHeic.length > 0) {
        showAlert(
          'These photos could not be uploaded because the HEIC format is too large to process.\n\n' +
          'Please retake the photo using "Most Compatible" (JPEG) mode in your iPhone camera settings, or choose a smaller image.'
        );
      } else {
        showAlert('Photo is too large. Please try again, or take a lower-resolution photo.');
      }
    } else if (totalSkipped > 0) {
      showAlert(
        `${uploadedUrls.length} photo(s) uploaded successfully.\n` +
        `${totalSkipped} photo(s) were skipped — they were too large or in an unsupported format. ` +
        `Please retake those using a lower resolution or JPEG mode.`
      );
    } else {
      showAlert(`${uploadedUrls.length} ${isDamage ? 'damage' : 'delivery'} photo(s) uploaded and saved successfully!`);
    }
  } catch (e: any) {
    const msg = (e.message || '').toLowerCase();
    if (msg.includes('size') || msg.includes('maximum')) {
      showAlert('Photo is too large. Please try again, or take a lower-resolution photo.');
    } else {
      showAlert('Failed to upload photos. Please try again.');
    }
  }
}

// ---- New-side driver: the modal's adoption code ----
async function newDriver(
  files: File[], isDamage: boolean | undefined, task: any, taskStatusId: string,
  supabase: any, compress: (f: File) => Promise<Blob | null>, now: () => number, rec: any[],
) {
  const refresh = () => { rec.push(['refresh']); };
  const showAlert = (m: string) => { rec.push(['alert', m]); };
  try {
    const result = await uploadTaskPhotos(
      { files, orderId: task.orderId, taskType: task.type, taskStatusId, isDamage },
      { client: supabase, compress, now },
    );
    if (result.uploadedUrls.length > 0) {
      refresh();
    }
    showAlert(buildPhotoUploadSummary(result, isDamage));
  } catch (e: any) {
    const msg = (e.message || '').toLowerCase();
    if (msg.includes('size') || msg.includes('maximum')) {
      showAlert('Photo is too large. Please try again, or take a lower-resolution photo.');
    } else {
      showAlert('Failed to upload photos. Please try again.');
    }
  }
}

const TASK = { orderId: 'ord-9', type: 'drop-off' };
const counter = () => { let t = 1000; return () => t++; };
const okUpload = (name: string) => ({ data: { path: name }, error: null });

interface Case {
  name: string; files: File[]; isDamage?: boolean;
  compress?: Record<string, CompressMode>; compressDefault?: CompressMode;
  upload?: (name: string) => { data: any; error: any };
  existing?: any; readError?: any; updateError?: any;
}

let compared = 0;
async function compare(c: Case) {
  const spec: FakeSpec = { upload: c.upload ?? okUpload, existing: c.existing ?? null, readError: c.readError, updateError: c.updateError };
  const o = fakeClient(spec); const n = fakeClient(spec);
  const ro: any[] = []; const rn: any[] = [];
  const compress = fakeCompress(c.compress ?? {}, c.compressDefault ?? 'ok');
  await quietAsync(async () => {
    await oracleHandler(c.files, c.isDamage, TASK, 'ts-5', o.client, compress, counter(), ro);
    await newDriver(c.files, c.isDamage, TASK, 'ts-5', n.client, compress, counter(), rn);
  });
  compared++;
  ok(`${c.name}: identical storage / task_status operations`, same(o.ops, n.ops));
  ok(`${c.name}: identical refresh/alert sequence`, same(ro, rn));
  return { ops: n.ops, rec: rn };
}

(async () => {
  // ---- helper unit pins ----
  ok('isHeicFile: image/heic', isHeicFile(mkFile('a.bin', 'image/heic', 1)));
  ok('isHeicFile: image/heif', isHeicFile(mkFile('a.bin', 'image/heif', 1)));
  ok('isHeicFile: MIME is case-insensitive', isHeicFile(mkFile('a.bin', 'IMAGE/HEIC', 1)));
  ok('isHeicFile: .heic extension', isHeicFile(mkFile('IMG_1.heic', '', 1)));
  ok('isHeicFile: .HEIF extension', isHeicFile(mkFile('IMG_1.HEIF', '', 1)));
  ok('isHeicFile: .heic.jpg is not HEIC', !isHeicFile(mkFile('IMG_1.heic.jpg', 'image/jpeg', 1)));
  ok('isHeicFile: jpeg is not HEIC', !isHeicFile(mkFile('a.jpg', 'image/jpeg', 1)));
  ok('isHeicFile: matches the old function', ['a.heic', 'a.HEIC', 'a.heif', 'a.jpg', 'x', 'a.hei'].every(n => ['', 'image/heic', 'IMAGE/HEIF', 'image/png'].every(t => isHeicFile(mkFile(n, t, 1)) === isHeicFileOld(mkFile(n, t, 1)))));
  ok('compressImage: HEIC short-circuits to null without a DOM', (await quietAsync(() => compressImage(mkFile('a.heic', 'image/heic', 5 * MB)))) === null);

  // ---- ordering and naming ----
  {
    const files = [mkFile('b one.jpg', 'image/jpeg', MB), mkFile('a#two.png', 'image/png', MB), mkFile('c.JPG', '', MB)];
    const r = await compare({ name: 'three normal images', files });
    const uploads = r.ops.filter((o: any) => o[0] === 'upload');
    eq('exact generated paths, bucket and options (sequential timestamps, sanitized, .jpg)', uploads, [
      ['upload', 'public-assets', 'ord-9-drop-off-1000-b_one.jpg', 'c:b one.jpg', { cacheControl: '3600', upsert: false }],
      ['upload', 'public-assets', 'ord-9-drop-off-1001-a_two.jpg', 'c:a#two.png', { cacheControl: '3600', upsert: false }],
      ['upload', 'public-assets', 'ord-9-drop-off-1002-c.jpg', 'c:c.JPG', { cacheControl: '3600', upsert: false }],
    ]);
    eq('success summary (delivery)', r.rec.filter((x: any) => x[0] === 'alert'), [['alert', '3 delivery photo(s) uploaded and saved successfully!']]);
  }
  {
    // uploads are strictly sequential: with a deferred first upload the second must not start early
    const order: string[] = [];
    const client: any = {
      storage: { from: () => ({
        upload: async (name: string) => { order.push('start ' + name); await new Promise(r => setTimeout(r, 5)); order.push('end ' + name); return { data: { path: name }, error: null }; },
        getPublicUrl: (p: string) => ({ data: { publicUrl: p } }),
      }) },
      from: () => { const b: any = { select: () => b, update: () => b, eq: () => Promise.resolve({ error: null }), maybeSingle: () => Promise.resolve({ data: null, error: null }) }; b.eq = () => Object.assign(Promise.resolve({ data: null, error: null }), b); return b; },
    };
    await quietAsync(() => uploadTaskPhotos({ files: [mkFile('1.jpg', 'image/jpeg', 1), mkFile('2.jpg', 'image/jpeg', 1)], orderId: 'o', taskType: 't', taskStatusId: 's' }, { client, compress: fakeCompress({}), now: counter() }));
    eq('sequential: each upload finishes before the next starts', order, ['start o-t-1000-1.jpg', 'end o-t-1000-1.jpg', 'start o-t-1001-2.jpg', 'end o-t-1001-2.jpg']);
  }

  // ---- HEIC ----
  {
    const r = await compare({ name: 'HEIC by MIME under limit uploaded as-is', files: [mkFile('x.dat', 'image/heic', 9 * MB)] });
    eq('HEIC original is uploaded under its own name without .jpg', r.ops.filter((o: any) => o[0] === 'upload').map((o: any) => [o[2], o[3]]), [['ord-9-drop-off-1000-x.dat', 'original']]);
  }
  await compare({ name: 'HEIC by extension under limit', files: [mkFile('IMG.HEIC', '', 3 * MB)] });
  await compare({ name: 'HEIF under limit', files: [mkFile('IMG.heif', 'image/heif', 3 * MB)] });
  await compare({ name: 'HEIC exactly at the limit', files: [mkFile('IMG.heic', 'image/heic', 10 * MB)] });
  {
    const r = await compare({ name: 'HEIC one byte over the limit is skipped', files: [mkFile('IMG.heic', 'image/heic', 10 * MB + 1)] });
    eq('no uploads and the HEIC message', r.rec, [['alert', 'These photos could not be uploaded because the HEIC format is too large to process.\n\nPlease retake the photo using "Most Compatible" (JPEG) mode in your iPhone camera settings, or choose a smaller image.']]);
  }
  await compare({ name: 'oversize HEIC skipped, normal image uploaded (mixed message)', files: [mkFile('a.heic', 'image/heic', 11 * MB), mkFile('b.jpg', 'image/jpeg', MB)] });

  // ---- compression ----
  await compare({ name: 'compression failure <= 10 MB uploads the original', files: [mkFile('weird.xyz', '', 2 * MB)], compress: { 'weird.xyz': 'fail' } });
  {
    const r = await compare({ name: 'compression failure > 10 MB is skipped', files: [mkFile('weird.xyz', '', 12 * MB)], compress: { 'weird.xyz': 'fail' } });
    eq('generic too-large message', r.rec, [['alert', 'Photo is too large. Please try again, or take a lower-resolution photo.']]);
  }
  await compare({ name: 'compression failure exactly 10 MB uploads the original', files: [mkFile('weird.xyz', '', 10 * MB)], compress: { 'weird.xyz': 'fail' } });
  await compare({ name: 'compressed name without extension gets .jpg appended', files: [mkFile('noext', 'image/jpeg', MB)] });
  await compare({ name: 'multi-dot name replaces only the last extension', files: [mkFile('a.b.c.png', 'image/png', MB)] });

  // ---- storage errors ----
  await compare({ name: 'size error skips and continues', files: [mkFile('a.jpg', 'image/jpeg', MB), mkFile('b.jpg', 'image/jpeg', MB)], upload: (n) => n.includes('-a.') ? { data: null, error: { message: 'The object exceeded the maximum allowed SIZE' } } : okUpload(n) });
  await compare({ name: 'maximum error skips and continues', files: [mkFile('a.jpg', 'image/jpeg', MB), mkFile('b.jpg', 'image/jpeg', MB)], upload: (n) => n.includes('-b.') ? { data: null, error: { message: 'Over MAXIMUM' } } : okUpload(n) });
  await compare({ name: 'uppercase SIZE-only message is skipped', files: [mkFile('a.jpg', 'image/jpeg', MB), mkFile('b.jpg', 'image/jpeg', MB)], upload: (n) => n.includes('-a.') ? { data: null, error: { message: 'Payload SIZE limit' } } : okUpload(n) });
  await compare({ name: 'all uploads rejected for size', files: [mkFile('a.jpg', 'image/jpeg', MB)], upload: () => ({ data: null, error: { message: 'size limit' } }) });
  {
    const r = await compare({
      name: 'fatal error aborts later files and nothing is persisted (orphans remain)',
      files: [mkFile('a.jpg', 'image/jpeg', MB), mkFile('b.jpg', 'image/jpeg', MB), mkFile('c.jpg', 'image/jpeg', MB)],
      upload: (n) => n.includes('-b.') ? { data: null, error: { message: 'network down' } } : okUpload(n),
    });
    eq('exactly two uploads attempted (the third never starts)', r.ops.filter((o: any) => o[0] === 'upload').length, 2);
    ok('no task_status read or write after the fatal error', !r.ops.some((o: any) => o[0] === 'from'));
    ok('no refresh', !r.rec.some((x: any) => x[0] === 'refresh'));
    eq('generic failure alert', r.rec.filter((x: any) => x[0] === 'alert'), [['alert', 'Failed to upload photos. Please try again.']]);
  }
  await compare({ name: 'error without a message is fatal', files: [mkFile('a.jpg', 'image/jpeg', MB)], upload: () => ({ data: null, error: {} }) });
  await compare({ name: 'fatal error whose message mentions size is skipped, not fatal', files: [mkFile('a.jpg', 'image/jpeg', MB)], upload: () => ({ data: null, error: { message: 'File size too big' } }) });

  // ---- persistence ----
  {
    const r = await compare({ name: 'delivery column merge appends after existing', files: [mkFile('a.jpg', 'image/jpeg', MB), mkFile('b.jpg', 'image/jpeg', MB)], existing: { delivery_images: ['old1', 'old2'] } });
    const upd = r.ops.find((o: any) => o[0] === 'update');
    eq('update payload keeps existing URLs first, uploaded appended in order', upd, ['update', { delivery_images: ['old1', 'old2', 'https://cdn.test/public-assets/ord-9-drop-off-1000-a.jpg', 'https://cdn.test/public-assets/ord-9-drop-off-1001-b.jpg'] }]);
    eq('read then write by id', r.ops.filter((o: any) => ['select', 'eq', 'maybeSingle', 'update'].includes(o[0])), [
      ['select', 'delivery_images'], ['eq', 'id', 'ts-5'], ['maybeSingle'],
      ['update', upd![1]], ['eq', 'id', 'ts-5'],
    ]);
  }
  {
    const r = await compare({ name: 'damage column', files: [mkFile('a.jpg', 'image/jpeg', MB)], isDamage: true, existing: { damage_images: ['d0'] } });
    eq('damage select and update column', r.ops.filter((o: any) => o[0] === 'select' || o[0] === 'update').map((o: any) => o[0] === 'select' ? o[1] : Object.keys(o[1])[0]), ['damage_images', 'damage_images']);
    eq('damage success wording', r.rec.filter((x: any) => x[0] === 'alert'), [['alert', '1 damage photo(s) uploaded and saved successfully!']]);
  }
  await compare({ name: 'no existing row data', files: [mkFile('a.jpg', 'image/jpeg', MB)], existing: null });
  await compare({ name: 'existing column is null', files: [mkFile('a.jpg', 'image/jpeg', MB)], existing: { delivery_images: null } });
  {
    const r = await compare({ name: 'read error throws the generic alert', files: [mkFile('a.jpg', 'image/jpeg', MB)], readError: { message: 'read failed' } });
    ok('no update after a read error', !r.ops.some((o: any) => o[0] === 'update'));
    ok('no refresh after a read error', !r.rec.some((x: any) => x[0] === 'refresh'));
  }
  await compare({ name: 'update error throws the generic alert', files: [mkFile('a.jpg', 'image/jpeg', MB)], updateError: { message: 'write failed' } });
  await compare({ name: 'persist error mentioning size maps to the too-large alert', files: [mkFile('a.jpg', 'image/jpeg', MB)], updateError: { message: 'row size exceeded' } });
  {
    const r = await compare({ name: 'zero uploaded URLs: no read, no update, no refresh', files: [mkFile('a.heic', 'image/heic', 11 * MB)] });
    ok('no task_status access when nothing uploaded', !r.ops.some((o: any) => o[0] === 'from'));
    ok('no refresh when nothing uploaded', !r.rec.some((x: any) => x[0] === 'refresh'));
  }
  {
    const r = await compare({ name: 'refresh happens before the alert', files: [mkFile('a.jpg', 'image/jpeg', MB)] });
    eq('refresh then alert', r.rec.map((x: any) => x[0]), ['refresh', 'alert']);
  }
  await compare({ name: 'mixed uploaded and skipped summary', files: [mkFile('a.jpg', 'image/jpeg', MB), mkFile('b.xyz', '', 12 * MB)], compress: { 'b.xyz': 'fail' } });
  await compare({ name: 'no files (defensive)', files: [] });

  // ---- summary text, exact ----
  eq('summary: HEIC only', buildPhotoUploadSummary({ uploadedUrls: [], skippedHeic: ['a.heic'], skippedLarge: [] }), 'These photos could not be uploaded because the HEIC format is too large to process.\n\nPlease retake the photo using "Most Compatible" (JPEG) mode in your iPhone camera settings, or choose a smaller image.');
  eq('summary: HEIC takes precedence over large when nothing uploaded', buildPhotoUploadSummary({ uploadedUrls: [], skippedHeic: ['a.heic'], skippedLarge: ['b.jpg'] }), 'These photos could not be uploaded because the HEIC format is too large to process.\n\nPlease retake the photo using "Most Compatible" (JPEG) mode in your iPhone camera settings, or choose a smaller image.');
  eq('summary: large only', buildPhotoUploadSummary({ uploadedUrls: [], skippedHeic: [], skippedLarge: ['b.jpg'] }), 'Photo is too large. Please try again, or take a lower-resolution photo.');
  eq('summary: mixed', buildPhotoUploadSummary({ uploadedUrls: ['u1', 'u2'], skippedHeic: ['a.heic'], skippedLarge: ['b.jpg'] }), '2 photo(s) uploaded successfully.\n2 photo(s) were skipped — they were too large or in an unsupported format. Please retake those using a lower resolution or JPEG mode.');
  eq('summary: delivery success', buildPhotoUploadSummary({ uploadedUrls: ['u'], skippedHeic: [], skippedLarge: [] }, false), '1 delivery photo(s) uploaded and saved successfully!');
  eq('summary: undefined isDamage is delivery', buildPhotoUploadSummary({ uploadedUrls: ['u'], skippedHeic: [], skippedLarge: [] }), '1 delivery photo(s) uploaded and saved successfully!');
  eq('summary: damage success', buildPhotoUploadSummary({ uploadedUrls: ['u', 'v'], skippedHeic: [], skippedLarge: [] }, true), '2 damage photo(s) uploaded and saved successfully!');

  // ---- seeded differential matrix ----
  {
    const r = rng(20260801);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
    const NAMES = ['a.jpg', 'B C.PNG', 'x#y.heic', 'IMG_2.HEIF', 'noext', 'a.b.c.webp', 'weird name (1).jpeg', 'ü.jpg', 'f.HEIC', 'g.heic.jpg'];
    const TYPES = ['image/jpeg', 'image/png', 'image/heic', 'IMAGE/HEIF', '', 'image/webp'];
    const SIZES = [1, MB, 9 * MB, 10 * MB, 10 * MB + 1, 12 * MB];
    const ERRS = [null, null, null, null, { message: 'File size exceeded' }, { message: 'maximum allowed' }, { message: 'network down' }, { message: 'Bucket Maximum' }, {}];
    const MATRIX = 600;
    for (let n = 0; n < MATRIX; n++) {
      const count = Math.floor(r() * 5);
      const files: File[] = Array.from({ length: count }, (_, i) => mkFile(`${i}-${pick(NAMES)}`, pick(TYPES), pick(SIZES)));
      const errFor: Record<string, any> = {};
      files.forEach((f, i) => { errFor[`-${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`] = pick(ERRS); void i; });
      const cmp: Record<string, CompressMode> = {};
      files.forEach(f => { cmp[f.name] = pick<CompressMode>(['ok', 'ok', 'fail']); });
      const existing = pick<any>([null, { delivery_images: ['p'] }, { damage_images: ['q', 'q2'] }, { delivery_images: null }]);
      await compare({
        name: `seeded ${n}`, files, isDamage: pick([true, false, undefined]), compress: cmp, existing,
        readError: pick([undefined, undefined, undefined, { message: 'read' }]),
        updateError: pick([undefined, undefined, undefined, { message: 'upd' }]),
        upload: (name) => {
          const key = Object.keys(errFor).find(k => name.includes(k));
          const e = key ? errFor[key] : null;
          return e ? { data: null, error: e } : okUpload(name);
        },
      });
    }
    ok(`seeded matrix ran ${MATRIX} cases`, compared >= MATRIX);
  }

  console.log(`Task photo upload differential tests: ${passed} passed, ${failed} failed (${compared} compared scenarios)`);
  if (failed > 0) throw new Error(`${failed} task photo upload test(s) failed`);
})();
