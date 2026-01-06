import { useState, useCallback, useEffect, useRef } from 'react';
import { PrintState, PrintStateInfo, PrintEventCallbacks } from '../lib/printUtils';

interface UsePrintOptions extends PrintEventCallbacks {
  autoOpenDelay?: number;
}

export function usePrint(options: UsePrintOptions = {}) {
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printState, setPrintState] = useState<PrintStateInfo>({
    state: 'idle',
    timestamp: Date.now(),
  });

  const printCancelledRef = useRef(false);

  const openPrintModal = useCallback(() => {
    setIsPrintModalOpen(true);
    setPrintState({ state: 'idle', timestamp: Date.now() });
    printCancelledRef.current = false;
  }, []);

  const closePrintModal = useCallback(() => {
    setIsPrintModalOpen(false);
    if (printState.state === 'printing') {
      printCancelledRef.current = true;
      setPrintState({ state: 'cancelled', timestamp: Date.now() });
      options.onPrintCancel?.();
    }
  }, [printState.state, options]);

  const print = useCallback(async () => {
    try {
      setPrintState({ state: 'preparing', message: 'Preparing document...', timestamp: Date.now() });
      options.onPrintStart?.();

      // Execute onBeforePrint (supports both sync and async)
      if (options.onBeforePrint) {
        await options.onBeforePrint();
      }

      if (printCancelledRef.current) {
        setPrintState({ state: 'cancelled', timestamp: Date.now() });
        return;
      }

      setPrintState({ state: 'printing', message: 'Printing...', timestamp: Date.now() });

      setTimeout(async () => {
        try {
          window.print();

          if (!printCancelledRef.current) {
            setPrintState({ state: 'success', message: 'Print successful', timestamp: Date.now() });
            options.onPrintSuccess?.();
          }

          // Execute onAfterPrint (supports both sync and async)
          if (options.onAfterPrint) {
            await options.onAfterPrint();
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error('Print failed');
          setPrintState({
            state: 'error',
            message: err.message,
            timestamp: Date.now()
          });
          options.onPrintError?.(err);
        }
      }, 100);
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Print preparation failed');
      setPrintState({
        state: 'error',
        message: err.message,
        timestamp: Date.now()
      });
      options.onPrintError?.(err);
    }
  }, [options]);

  const printImmediately = useCallback(() => {
    setTimeout(() => {
      print();
    }, options.autoOpenDelay || 100);
  }, [print, options.autoOpenDelay]);

  const resetPrintState = useCallback(() => {
    setPrintState({ state: 'idle', timestamp: Date.now() });
    printCancelledRef.current = false;
  }, []);

  useEffect(() => {
    const handleBeforePrint = async () => {
      if (options.onBeforePrint) {
        await options.onBeforePrint();
      }
    };

    const handleAfterPrint = async () => {
      if (options.onAfterPrint) {
        await options.onAfterPrint();
      }
    };

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);

    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, [options]);

  return {
    isPrintModalOpen,
    openPrintModal,
    closePrintModal,
    print,
    printImmediately,
    printState,
    isPrinting: printState.state === 'printing' || printState.state === 'preparing',
    resetPrintState,
  };
}
