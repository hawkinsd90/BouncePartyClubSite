import { notifyError } from '../toasts';
import { reportError } from './errorReporter';
import { asErrorLike } from './errorLike';

export class AppError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function isSupabaseError(error: unknown): boolean {
  const e = asErrorLike(error);
  // Returns the truthy value itself (callers only test truthiness), exactly as before.
  return (error && (e.code || e.hint || e.details)) as boolean;
}

export function formatSupabaseError(error: unknown): string {
  const e = asErrorLike(error);
  if (e.message?.includes('row-level security')) {
    return 'Permission denied. Please ensure you are logged in with the correct account.';
  }

  if (e.code === 'PGRST116') {
    return 'No data found matching your request.';
  }

  if (e.code === '23505') {
    return 'This record already exists.';
  }

  if (e.code === '23503') {
    return 'Cannot delete this record as it is referenced by other data.';
  }

  return e.message || 'Database operation failed';
}

export function handleError(error: unknown, context?: string, silent = false): void {
  console.error(`[Error${context ? ` in ${context}` : ''}]:`, error);

  if (silent) {
    return;
  }

  const additionalInfo: Record<string, unknown> = {};
  if (context) additionalInfo.context = context;
  if (isSupabaseError(error)) {
    const e = asErrorLike(error);
    if (e.code) additionalInfo.supabaseCode = e.code;
    if (e.hint) additionalInfo.supabaseHint = e.hint;
    if (e.details) additionalInfo.supabaseDetails = e.details;
  }

  if (error instanceof Error) {
    reportError(error, additionalInfo);
    notifyError(
      error instanceof AppError
        ? error.message
        : isSupabaseError(error)
          ? formatSupabaseError(error)
          : error.message || 'An unexpected error occurred'
    );
    return;
  }

  if (typeof error === 'string') {
    reportError(error, additionalInfo);
    notifyError(error);
    return;
  }

  const message = 'An unexpected error occurred. Please try again.';
  reportError(message, { ...additionalInfo, raw: String(error) });
  notifyError(message);
}

export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  context?: string,
  silent = false
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    handleError(error, context, silent);
    return null;
  }
}

export async function queryWithErrorHandling<T>(
  queryFn: () => Promise<{ data: T | null; error: unknown }>,
  options: {
    errorMessage?: string;
    context?: string;
    silent?: boolean;
  } = {}
): Promise<T | null> {
  const { errorMessage, context, silent = false } = options;
  const { data, error } = await queryFn();

  if (error) {
    if (!silent) {
      notifyError(errorMessage || formatSupabaseError(error));
    }
    console.error(`Query error${context ? ` in ${context}` : ''}:`, error);
    return null;
  }

  return data;
}

export function createErrorBoundary(context: string) {
  return {
    handleError: (error: unknown) => handleError(error, context),
    withHandling: <T>(fn: () => Promise<T>) => withErrorHandling(fn, context),
  };
}
