import { useState, useCallback, useEffect } from 'react';

interface UsePrintOptions {
  onBeforePrint?: () => void;
  onAfterPrint?: () => void;
  autoOpenDelay?: number;
}

export function usePrint(options: UsePrintOptions = {}) {
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  const openPrintModal = useCallback(() => {
    setIsPrintModalOpen(true);
  }, []);

  const closePrintModal = useCallback(() => {
    setIsPrintModalOpen(false);
  }, []);

  const print = useCallback(() => {
    setIsPrinting(true);
    options.onBeforePrint?.();

    setTimeout(() => {
      window.print();
      setIsPrinting(false);
      options.onAfterPrint?.();
    }, 100);
  }, [options]);

  const printImmediately = useCallback(() => {
    setTimeout(() => {
      print();
    }, options.autoOpenDelay || 100);
  }, [print, options.autoOpenDelay]);

  useEffect(() => {
    const handleBeforePrint = () => {
      options.onBeforePrint?.();
    };

    const handleAfterPrint = () => {
      options.onAfterPrint?.();
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
    isPrinting,
  };
}
