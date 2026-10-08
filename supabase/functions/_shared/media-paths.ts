// Storage references stored in the database.
//
// Historically the application stored the PUBLIC URL of a Storage object (".../storage/v1/object/public/<bucket>/<path>") in
// its tables (signature images, signed waiver PDFs). Once a bucket is private that URL no longer works, so readers turn the
// stored reference back into a bucket path and ask the server for a short-lived signed URL. This module is pure (no Deno, no
// network) so the exact parsing rules are unit-tested.

// A genuine Supabase project host: a 20-letter project ref under supabase.co. Historical rows hold URLs from more than one
// project (Dev rows carry Production's host), so the ref is not pinned; but a look-alike path on any other host is not a
// Storage reference. The host is only validated, never contacted: the object is always signed by the CURRENT project's client.
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.co$/;
const OBJECT_URL_PATH = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/;

// Returns the object path inside `bucket` for a stored reference, or null when the reference is not an object of that bucket.
// Accepted: an https Storage object URL (public, sign or authenticated form) on a Supabase project host for that bucket, or a
// bare object path. Rejected: any other host or scheme, userinfo or port, another bucket, an empty path, path traversal
// (plain or encoded), backslashes, control characters, absolute paths, other URLs.
export function storagePathFromReference(reference: unknown, bucket: string): string | null {
  if (typeof reference !== "string") return null;
  const ref = reference.trim();
  if (!ref || ref.length > 2048) return null;

  let path: string;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
    let url: URL;
    try {
      url = new URL(ref);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!SUPABASE_PROJECT_HOST.test(url.hostname)) return null;
    // Dot segments are checked on the raw text too: the URL parser would silently resolve an encoded "%2e%2e".
    const rawPath = ref.replace(/^https:\/\/[^/?#]*/i, "").split(/[?#]/)[0];
    if (/(^|\/)(?:\.|%2e){1,2}(\/|$)/i.test(rawPath)) return null;
    const m = url.pathname.match(OBJECT_URL_PATH);
    if (!m || m[1] !== bucket) return null;
    try {
      path = decodeURIComponent(m[2]);
    } catch {
      return null;
    }
  } else {
    if (ref.includes("://") || ref.startsWith("/")) return null;
    path = ref;
  }

  if (!path || path.startsWith("/") || path.endsWith("/")) return null;
  if (path.includes("\\") || [...path].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return null;
  if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return path;
}

// Lifetimes (seconds) of the signed URLs handed to a browser. Short on purpose: a URL is a bearer credential.
export const SIGNED_MEDIA_SECONDS = 3600;

export interface SignedMediaClient {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (path: string, expiresIn: number) => Promise<{ data: { signedUrl?: string } | null; error: unknown }>;
    };
  };
}

// Signs a stored reference for a bucket. Returns null (never a public URL) when the reference is not an object of that
// bucket or the object cannot be signed.
export async function signStoredMedia(
  client: SignedMediaClient,
  bucket: string,
  reference: unknown,
  expiresIn: number = SIGNED_MEDIA_SECONDS,
): Promise<string | null> {
  const path = storagePathFromReference(reference, bucket);
  if (!path) return null;
  try {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
