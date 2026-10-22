import { useState, useEffect, useCallback, useRef } from 'react';
import { notifyError } from '../../lib/toasts';
import { shouldRaiseLoading } from '../../lib/core/loadingPolicy';

interface DataFetchOptions<T> {
  onSuccess?: (data: T) => void;
  onError?: (error: unknown) => void;
  errorMessage?: string;
  autoFetch?: boolean;
  showErrorNotification?: boolean;
  // Screens that hold unsaved work in a modal (Orders, Admin): a refetch must not flip `loading` back on once data is showing,
  // because the page replaces itself with a spinner and the open modal is lost. The first load still reports loading.
  keepDataWhileRefetching?: boolean;
}

interface DataFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useDataFetch<T>(
  fetchFn: () => Promise<T>,
  options: DataFetchOptions<T> = {}
): DataFetchResult<T> {
  const {
    onSuccess,
    onError,
    errorMessage = 'Failed to load data',
    autoFetch = true,
    showErrorNotification = true,
    keepDataWhileRefetching = false,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const hasDataRef = useRef(false);
  const raiseLoading = useCallback(() => shouldRaiseLoading({ keepDataWhileRefetching, hasData: hasDataRef.current }), [keepDataWhileRefetching]);
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    if (raiseLoading()) setLoading(true);
    setError(null);

    try {
      const result = await fetchFn();
      hasDataRef.current = true;
      setData(result);
      onSuccess?.(result);
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      setError(errorObj);

      if (showErrorNotification) {
        notifyError(errorMessage);
      }

      onError?.(err);
      console.error('Data fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchFn, onSuccess, onError, errorMessage, showErrorNotification, raiseLoading]);

  useEffect(() => {
    let cancelled = false;

    if (autoFetch) {
      (async () => {
        try {
          if (raiseLoading()) setLoading(true);
          setError(null);

          const result = await fetchFn();

          if (!cancelled) {
            hasDataRef.current = true;
            setData(result);
            onSuccess?.(result);
          }
        } catch (err) {
          if (!cancelled) {
            const errorObj = err instanceof Error ? err : new Error(String(err));
            setError(errorObj);

            if (showErrorNotification) {
              notifyError(errorMessage);
            }

            onError?.(err);
            console.error('Data fetch error:', err);
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [autoFetch, fetchFn, onSuccess, onError, errorMessage, showErrorNotification, raiseLoading]);

  return { data, loading, error, refetch: fetchData };
}

interface MutationOptions<TData> {
  onSuccess?: (data: TData) => void;
  onError?: (error: unknown) => void;
  successMessage?: string;
  errorMessage?: string;
  showSuccessNotification?: boolean;
  showErrorNotification?: boolean;
}

interface MutationResult<TData, TVariables> {
  mutate: (variables: TVariables) => Promise<TData | null>;
  loading: boolean;
  error: Error | null;
  data: TData | null;
}

export function useMutation<TData = unknown, TVariables = unknown>(
  mutateFn: (variables: TVariables) => Promise<TData>,
  options: MutationOptions<TData> = {}
): MutationResult<TData, TVariables> {
  const {
    onSuccess,
    onError,
    successMessage,
    errorMessage = 'Operation failed',
    showSuccessNotification = !!successMessage,
    showErrorNotification = true,
  } = options;

  const [data, setData] = useState<TData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutate = useCallback(
    async (variables: TVariables): Promise<TData | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await mutateFn(variables);
        setData(result);

        if (showSuccessNotification && successMessage) {
          const { notifySuccess } = await import('../../lib/toasts');
          notifySuccess(successMessage);
        }

        onSuccess?.(result);
        return result;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);

        if (showErrorNotification) {
          notifyError(errorMessage);
        }

        onError?.(err);
        console.error('Mutation error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [mutateFn, onSuccess, onError, successMessage, errorMessage, showSuccessNotification, showErrorNotification]
  );

  return { mutate, loading, error, data };
}

export function useSupabaseQuery<T>(
  queryFn: () => Promise<{ data: T | null; error: { message?: string } | null }>,
  options: Omit<DataFetchOptions<T>, 'onError'> & {
    onError?: (error: { message?: string }, data: T | null) => void;
  } = {}
): DataFetchResult<T> {
  const {
    onSuccess,
    onError,
    errorMessage = 'Database query failed',
    autoFetch = true,
    showErrorNotification = true,
  } = options;

  const fetchData = useCallback(async (): Promise<T> => {
    const { data, error } = await queryFn();

    if (error) {
      onError?.(error, data);
      throw new Error(error.message || errorMessage);
    }

    if (!data) {
      throw new Error('No data returned');
    }

    return data;
  }, [queryFn, errorMessage, onError]);

  return useDataFetch(fetchData, {
    onSuccess,
    errorMessage,
    autoFetch,
    showErrorNotification,
  });
}
