// Crew task photo pipeline, extracted verbatim from TaskDetailModal.handleImageUpload.
//
// Feature-local (not a site-wide image service). Owns HEIC detection, canvas compression, per-file
// processing, storage upload, skip classification, and the read-merge-write of the task_status image
// column. The modal keeps the file picker, busy state, ensureTaskStatus, refresh and the alert.
//
// Current semantics kept on purpose: files are processed sequentially in picker order; a non-size
// storage error aborts the batch before anything is persisted (earlier uploads become orphans); the
// persistence step is a non-atomic read-merge-write.
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
  storage: { from(bucket: string): any };
  from(table: string): any;
}

export interface TaskPhotoUploadDeps {
  client: TaskPhotoClient;
  // Replaceable so tests need no DOM. Defaults to the canvas compressor above.
  compress?: (file: File) => Promise<Blob | null>;
  // Replaceable so tests control filename timestamps. Defaults to Date.now.
  now?: () => number;
}

export interface TaskPhotoUploadInput {
  files: File[];
  orderId: string;
  taskType: string;
  taskStatusId: string;
  isDamage?: boolean;
}

export interface TaskPhotoUploadResult {
  uploadedUrls: string[];
  skippedHeic: string[];
  skippedLarge: string[];
}

// Uploads the selected files one at a time, then persists the URLs. Returns only after persistence
// succeeded (or immediately when nothing was uploaded). Throws on a fatal storage or persistence error.
export async function uploadTaskPhotos(
  { files, orderId, taskType, taskStatusId, isDamage }: TaskPhotoUploadInput,
  deps: TaskPhotoUploadDeps,
): Promise<TaskPhotoUploadResult> {
  const supabase = deps.client;
  const compress = deps.compress ?? compressImage;
  const now = deps.now ?? Date.now;

  const uploadedUrls: string[] = [];
  const skippedHeic: string[] = [];
  const skippedLarge: string[] = [];

  for (const file of files) {
    const heic = isHeicFile(file);
    const effectiveType = file.type || (heic ? 'image/heic' : 'unknown');
    console.log(`[photos] Processing: ${file.name} | type: ${effectiveType} | size: ${(file.size / 1024 / 1024).toFixed(2)} MB`);

    let uploadBlob: Blob = file;
    let uploadName = `${orderId}-${taskType}-${now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    if (heic) {
      if (file.size <= BUCKET_LIMIT_BYTES) {
        console.log(`[photos] HEIC within limit, uploading as-is`);
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
        uploadName = uploadName.replace(/\.[^.]+$/, '') + '.jpg';
      } else {
        // Canvas could not decode (unsupported type or no context); try original if within limit
        if (file.size > BUCKET_LIMIT_BYTES) {
          console.warn(`[photos] Uncompressible and too large: ${file.name}`);
          skippedLarge.push(file.name);
          continue;
        }
        console.log(`[photos] Compression unavailable, uploading original`);
      }
    }

    const { data, error } = await supabase.storage
      .from('public-assets')
      .upload(uploadName, uploadBlob, { cacheControl: '3600', upsert: false });

    if (error) {
      console.error(`[photos] Upload failed for ${file.name}:`, error);
      // Treat storage-side size rejections as skipped, not fatal
      if (error.message?.toLowerCase().includes('size') || error.message?.toLowerCase().includes('maximum')) {
        skippedLarge.push(file.name);
        continue;
      }
      throw error;
    }

    const { data: urlData } = supabase.storage.from('public-assets').getPublicUrl(data.path);
    uploadedUrls.push(urlData.publicUrl);
    console.log(`[photos] Uploaded successfully: ${file.name}`);
  }

  // Persist any successfully uploaded URLs before showing messages
  if (uploadedUrls.length > 0) {
    const col = isDamage ? 'damage_images' : 'delivery_images';
    const { data: cur, error: fetchErr } = await supabase
      .from('task_status').select(col).eq('id', taskStatusId).maybeSingle();
    if (fetchErr) throw fetchErr;
    const merged = [...((cur as any)?.[col] || []), ...uploadedUrls];
    const { error: updErr } = await supabase.from('task_status').update({ [col]: merged }).eq('id', taskStatusId);
    if (updErr) throw updErr;
    console.log(`[photos] Saved ${uploadedUrls.length} URL(s) to task_status.${col}`);
  }

  return { uploadedUrls, skippedHeic, skippedLarge };
}

// The alert text for a completed (non-throwing) upload run.
export function buildPhotoUploadSummary(
  { uploadedUrls, skippedHeic, skippedLarge }: TaskPhotoUploadResult,
  isDamage?: boolean,
): string {
  const totalSkipped = skippedHeic.length + skippedLarge.length;

  if (uploadedUrls.length === 0 && totalSkipped > 0) {
    if (skippedHeic.length > 0) {
      return (
        'These photos could not be uploaded because the HEIC format is too large to process.\n\n' +
        'Please retake the photo using "Most Compatible" (JPEG) mode in your iPhone camera settings, or choose a smaller image.'
      );
    }
    return 'Photo is too large. Please try again, or take a lower-resolution photo.';
  } else if (totalSkipped > 0) {
    return (
      `${uploadedUrls.length} photo(s) uploaded successfully.\n` +
      `${totalSkipped} photo(s) were skipped — they were too large or in an unsupported format. ` +
      `Please retake those using a lower resolution or JPEG mode.`
    );
  }
  return `${uploadedUrls.length} ${isDamage ? 'damage' : 'delivery'} photo(s) uploaded and saved successfully!`;
}
