async function reportError(error: Error | string, _additionalInfo?: Record<string, any>) {
  try {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const errorStack = typeof error === 'string' ? undefined : error.stack;

    console.error('Error occurred:', errorMessage, errorStack);

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
