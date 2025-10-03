import { supabase } from './supabase';

interface ErrorDetails {
  message: string;
  stack?: string;
  componentStack?: string;
  url?: string;
  userId?: string;
  additionalInfo?: Record<string, any>;
}

async function reportError(error: Error | string, additionalInfo?: Record<string, any>) {
  try {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const errorStack = typeof error === 'string' ? undefined : error.stack;

    const { data: { user } } = await supabase.auth.getUser();

    const errorDetails: ErrorDetails = {
      message: errorMessage,
      stack: errorStack,
      url: window.location.href,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      userId: user?.id,
      additionalInfo,
    };

    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-error-notification`;

    const headers = {
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(errorDetails),
    });

    if (!response.ok) {
      console.error('Failed to report error to server');
    }
  } catch (reportingError) {
    console.error('Error while reporting error:', reportingError);
  }
}

export function setupGlobalErrorHandler() {
  window.addEventListener('error', (event) => {
    console.error('Global error caught:', event.error);

    reportError(event.error || event.message, {
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

export { reportError };
