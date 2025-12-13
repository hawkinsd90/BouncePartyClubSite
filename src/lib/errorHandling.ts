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

export function handleError(error: unknown, context?: string): void {
  console.error(`[Error${context ? ` in ${context}` : ''}]:`, error);

  if (error instanceof AppError) {
    notifyError(error.message);
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
  context?: string
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    handleError(error, context);
    return null;
  }
}

export async function queryWithErrorHandling<T>(
  queryFn: () => Promise<{ data: T | null; error: any }>,
  errorMessage?: string
): Promise<T | null> {
  const { data, error } = await queryFn();

  if (error) {
    notifyError(errorMessage || error.message || 'Database query failed');
    console.error('Query error:', error);
    return null;
  }

  return data;
}
