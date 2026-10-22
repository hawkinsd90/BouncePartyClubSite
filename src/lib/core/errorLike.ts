// Typed access to whatever a `catch` block receives. A caught value used to be typed `any`, so code read `err.message`, `err.code` or
// `err.status` straight off it. With `unknown` that needs a narrowing step; this helper does it without changing what is read:
// the properties are read from the same object, and anything that is not an object (a thrown string, null) simply has none of them,
// exactly as `undefined` properties did before.
export interface ErrorLike {
  message?: string;
  name?: string;
  code?: string;
  status?: number;
  details?: unknown;
  hint?: unknown;
}

export function asErrorLike(err: unknown): ErrorLike {
  return err !== null && typeof err === 'object' ? (err as ErrorLike) : {};
}
