const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface ErrorPayload {
  message: string;
  stack?: string;
  componentStack?: string;
  userAgent?: string;
  url?: string;
  timestamp?: string;
  userId?: string;
  additionalInfo?: Record<string, unknown>;
}

async function getUserId(): Promise<string | undefined> {
  try {
    const raw = localStorage.getItem('bpc-auth');
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed?.user?.id as string | undefined;
  } catch {
    return undefined;
  }
}

export async function reportError(
  error: Error | string,
  additionalInfo?: Record<string, unknown>
): Promise<void> {
  const errorMessage = typeof error === 'string' ? error : error.message;
  const errorStack = typeof error === 'string' ? undefined : error.stack;

  console.error('[ErrorReporter]', errorMessage, errorStack);

  try {
    const userId = await getUserId();

    const payload: ErrorPayload = {
      message: errorMessage,
      stack: errorStack,
      userAgent: navigator.userAgent,
      url: window.location.href,
      timestamp: new Date().toISOString(),
      userId,
      additionalInfo: additionalInfo && Object.keys(additionalInfo).length > 0
        ? additionalInfo
        : undefined,
    };

    await fetch(`${SUPABASE_URL}/functions/v1/send-error-notification`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (reportingError) {
    console.error('[ErrorReporter] Failed to send error notification:', reportingError);
  }
}

export function setupGlobalErrorHandler() {
  window.addEventListener('error', (event) => {
    console.error('Global error caught:', event.error);

    reportError(event.error instanceof Error ? event.error : new Error(event.message), {
      type: 'uncaughtException',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);

    const error = event.reason instanceof Error
      ? event.reason
      : new Error(String(event.reason));

    reportError(error, {
      type: 'unhandledRejection',
    });
  });
}
