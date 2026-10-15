// Crew task photo pipeline (delivery / pickup / damage proof photos).
//
// Feature-local (not a site-wide image service). Owns HEIC detection, canvas compression, per-file
// processing, the signed upload into the PRIVATE order-evidence bucket, skip classification and the
// registration of the uploaded photos on the task. The modal keeps the file picker, busy state,
// ensureTaskStatus, refresh and the alert.
//
// Semantics kept on purpose: files are processed sequentially in picker order; a non-size storage error
// aborts the batch before anything is persisted; the task is only updated after every upload of the batch
// finished. What changed: the browser no longer writes to a public bucket or stores a public URL. The
// task-evidence function authorizes each object (the server chooses bucket and path), records the bare
// object paths, and removes objects of a failed batch.
/* eslint-disable @typescript-eslint/no-explicit-any */

const BUCKET_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB — matches live bucket limit

export function isHeicFile(file: File): boolean {
  const mimeHeic = ['image/heic', 'image/heif'];
  if (mimeHeic.includes(file.type.toLowerCase())) return true;
  return /\.hei[cf]$/i.test(file.name);
}

export async function compressImage(file: File): Promise<Blob | null> {
  const MAX_DIMENSION = 2048;
  const JPEG_QUALITY = 0.82;

  // HEIC cannot be decoded by canvas in most browsers — caller handles separately
  if (isHeicFile(file)) {
    console.log(`[photos] HEIC/HEIF detected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB) — skipping canvas compression`);
    return null;
  }

  // Files with no MIME type (some Android/picker edge cases): attempt compression anyway;
  // if the browser cannot decode the image, img.onerror fires and we return null.
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', JPEG_QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
    img.src = objectUrl;
  });
}

export interface TaskPhotoClient {
  // Signed uploads into the private evidence bucket: the browser sends a file only to an object the server authorized.
  storage: { from(bucket: string): any };
  // The task-evidence Edge Function (authorization, registration, cleanup).
  functions: { invoke(name: string, options: { body: any }): Promise<any> };
}

export interface TaskPhotoUploadDeps {
  client: TaskPhotoClient;
  // Replaceable so tests need no DOM. Defaults to the canvas compressor above.
  compress?: (file: File) => Promise<Blob | null>;
}

export interface TaskPhotoUploadInput {
  files: File[];
  orderId: string;
  taskType: string;
  taskStatusId: string;
  isDamage?: boolean;
}

export interface TaskPhotoUploadResult {
  // Stable private object paths now recorded on the task (never URLs).
  uploadedPaths: string[];
  skippedHeic: string[];
  skippedLarge: string[];
}

// Image types the private evidence bucket accepts (the same list the server enforces).
const EVIDENCE_UPLOAD_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'];

async function invokeEvidence(deps: TaskPhotoUploadDeps, body: Record<string, unknown>): Promise<any> {
  const { data, error } = await deps.client.functions.invoke('task-evidence', { body });
  if (error || !data?.success) throw new Error('Photo upload was not authorized');
  return data;
}

// Uploads the selected files one at a time to the private evidence bucket, then records them on the task. Returns only after
// the server confirmed the photos are saved on the task (or immediately when nothing was uploaded). Throws on a fatal
// authorization, storage or persistence error; objects uploaded before a fatal error are removed by the server.
export async function uploadTaskPhotos(
  { files, taskStatusId, isDamage }: TaskPhotoUploadInput,
  deps: TaskPhotoUploadDeps,
): Promise<TaskPhotoUploadResult> {
  const supabase = deps.client;
  const compress = deps.compress ?? compressImage;
  const kind = isDamage ? 'damage' : 'delivery';

  const uploadedPaths: string[] = [];
  const issuedPaths: string[] = [];
  const skippedHeic: string[] = [];
  const skippedLarge: string[] = [];

  try {
    for (const file of files) {
      const heic = isHeicFile(file);
      const effectiveType = file.type || (heic ? 'image/heic' : 'unknown');
      console.log(`[photos] Processing: ${file.name} | type: ${effectiveType} | size: ${(file.size / 1024 / 1024).toFixed(2)} MB`);

      let uploadBlob: Blob = file;
      let uploadLabel = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      let uploadType = effectiveType.toLowerCase();

      if (heic) {
        if (file.size <= BUCKET_LIMIT_BYTES) {
          console.log(`[photos] HEIC within limit, uploading as-is`);
          if (!EVIDENCE_UPLOAD_TYPES.includes(uploadType)) uploadType = 'image/heic';
        } else {
          console.warn(`[photos] HEIC too large to upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
          skippedHeic.push(file.name);
          continue;
        }
      } else {
        const compressed = await compress(file);
        if (compressed) {
          console.log(`[photos] Compressed: ${(file.size / 1024 / 1024).toFixed(2)} MB → ${(compressed.size / 1024 / 1024).toFixed(2)} MB`);
          uploadBlob = compressed;
          uploadLabel = uploadLabel.replace(/\.[^.]+$/, '') + '.jpg';
          uploadType = 'image/jpeg';
        } else {
          // Canvas could not decode (unsupported type or no context); try original if within limit
          if (file.size > BUCKET_LIMIT_BYTES) {
            console.warn(`[photos] Uncompressible and too large: ${file.name}`);
            skippedLarge.push(file.name);
            continue;
          }
          if (!EVIDENCE_UPLOAD_TYPES.includes(uploadType)) {
            console.warn(`[photos] Unsupported image type, skipped: ${file.name}`);
            skippedLarge.push(file.name);
            continue;
          }
          console.log(`[photos] Compression unavailable, uploading original`);
        }
      }

      // The server derives the order from the task, chooses the bucket and the object path, and authorizes this one object.
      const grant = await invokeEvidence(deps, {
        action: 'request_upload',
        taskStatusId,
        kind,
        files: [{ name: uploadLabel, size: uploadBlob.size, mimeType: uploadType }],
      });
      const target = grant.uploads?.[0];
      if (!target?.path || !target?.token) throw new Error('Photo upload was not authorized');
      issuedPaths.push(target.path);

      const { error } = await supabase.storage
        .from(grant.bucket)
        .uploadToSignedUrl(target.path, target.token, uploadBlob, { contentType: uploadType, cacheControl: '3600' });

      if (error) {
        console.error(`[photos] Upload failed for ${file.name}:`, error);
        // Treat storage-side size rejections as skipped, not fatal
        if (error.message?.toLowerCase().includes('size') || error.message?.toLowerCase().includes('maximum')) {
          skippedLarge.push(file.name);
          continue;
        }
        throw error;
      }

      uploadedPaths.push(target.path);
      console.log(`[photos] Uploaded successfully: ${file.name}`);
    }

    // Persist any successfully uploaded photos before showing messages (the server appends them to the task's column).
    if (uploadedPaths.length > 0) {
      await invokeEvidence(deps, { action: 'register', taskStatusId, kind, paths: uploadedPaths });
      console.log(`[photos] Saved ${uploadedPaths.length} photo(s) to the ${kind} evidence of the task`);
    }
  } catch (e) {
    // Objects already uploaded for this batch are removed by the server (the browser never deletes from Storage).
    if (issuedPaths.length > 0) {
      try {
        await deps.client.functions.invoke('task-evidence', { body: { action: 'discard', taskStatusId, kind, paths: issuedPaths } });
      } catch {
        /* the objects stay private */
      }
    }
    throw e;
  }

  return { uploadedPaths, skippedHeic, skippedLarge };
}

// The alert text for a completed (non-throwing) upload run.
export function buildPhotoUploadSummary(
  { uploadedPaths, skippedHeic, skippedLarge }: TaskPhotoUploadResult,
  isDamage?: boolean,
): string {
  const totalSkipped = skippedHeic.length + skippedLarge.length;

  if (uploadedPaths.length === 0 && totalSkipped > 0) {
    if (skippedHeic.length > 0) {
      return (
        'These photos could not be uploaded because the HEIC format is too large to process.\n\n' +
        'Please retake the photo using "Most Compatible" (JPEG) mode in your iPhone camera settings, or choose a smaller image.'
      );
    }
    return 'Photo is too large. Please try again, or take a lower-resolution photo.';
  } else if (totalSkipped > 0) {
    return (
      `${uploadedPaths.length} photo(s) uploaded successfully.\n` +
      `${totalSkipped} photo(s) were skipped — they were too large or in an unsupported format. ` +
      `Please retake those using a lower resolution or JPEG mode.`
    );
  }
  return `${uploadedPaths.length} ${isDamage ? 'damage' : 'delivery'} photo(s) uploaded and saved successfully!`;
}
