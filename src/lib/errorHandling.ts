import { notifyError } from './notifications';

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

export function isSupabaseError(error: any): boolean {
  return error && (error.code || error.hint || error.details);
}

export function formatSupabaseError(error: any): string {
  if (error.message?.includes('row-level security')) {
    return 'Permission denied. Please ensure you are logged in with the correct account.';
  }

  if (error.code === 'PGRST116') {
    return 'No data found matching your request.';
  }

  if (error.code === '23505') {
    return 'This record already exists.';
  }

  if (error.code === '23503') {
    return 'Cannot delete this record as it is referenced by other data.';
  }

  return error.message || 'Database operation failed';
}

export function handleError(error: unknown, context?: string, silent = false): void {
  console.error(`[Error${context ? ` in ${context}` : ''}]:`, error);

  if (silent) {
    return;
  }

  if (error instanceof AppError) {
    notifyError(error.message);
    return;
  }

  if (isSupabaseError(error)) {
    notifyError(formatSupabaseError(error));
    return;
  }

  if (error instanceof Error) {
    notifyError(error.message || 'An unexpected error occurred');
    return;
  }

  if (typeof error === 'string') {
    notifyError(error);
    return;
  }

  notifyError('An unexpected error occurred. Please try again.');
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
  queryFn: () => Promise<{ data: T | null; error: any }>,
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
