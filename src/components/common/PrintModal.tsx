import { Printer, X, Download, ZoomIn, ZoomOut, Loader2, AlertCircle } from 'lucide-react';
import { MODAL_PANEL_SCROLL } from '../../lib/core/modalClasses';
import { ReactNode, useEffect, useState, useCallback, useRef } from 'react';
import { PrintState, PrintDocumentType, PRINT_TEMPLATES } from '../../lib/documents/printableDocument';
import { ZOOM_LEVELS, stepZoom } from '../../lib/core/printZoom';

interface PrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  onBeforePrint?: () => void | Promise<void>;
  onAfterPrint?: () => void | Promise<void>;
  onPrintError?: (error: Error) => void;
  printButtonText?: string;
  showDownloadButton?: boolean;
  showZoomControls?: boolean;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | 'full';
  documentType?: PrintDocumentType;
  printState?: PrintState;
  printStateMessage?: string;
}

export function PrintModal({
  isOpen,
  onClose,
  title = 'Print Preview',
  children,
  onBeforePrint,
  onAfterPrint,
  onPrintError,
  printButtonText = 'Print / Save PDF',
  showDownloadButton = false,
  showZoomControls = true,
  maxWidth = '5xl',
  documentType,
  printState = 'idle',
  printStateMessage,
}: PrintModalProps) {
  const [zoom, setZoom] = useState(100);
  const [isProcessing, setIsProcessing] = useState(false);
  // The guard against starting a second print run is read synchronously (a state value would still be false for a second key press in the same tick),
  // and the keyboard listener always calls the handlers of the latest render (it is bound once per isOpen / onClose).
  const processingRef = useRef(false);
  const setProcessing = (value: boolean) => {
    processingRef.current = value;
    setIsProcessing(value);
  };
  const handlersRef = useRef<{ print: () => void; zoomIn: () => void; zoomOut: () => void }>({ print: () => {}, zoomIn: () => {}, zoomOut: () => {} });
  const modalRef = useRef<HTMLDivElement>(null);
  const printButtonRef = useRef<HTMLButtonElement>(null);

  // Get template settings if documentType is provided
  const template = documentType ? PRINT_TEMPLATES[documentType] : null;

  // Accessibility: Focus management
  useEffect(() => {
    if (isOpen) {
      printButtonRef.current?.focus();

      // Announce modal opened to screen readers
      const announcement = document.createElement('div');
      announcement.setAttribute('role', 'status');
      announcement.setAttribute('aria-live', 'polite');
      announcement.className = 'sr-only';
      announcement.textContent = `${title} opened. Press Control P or Command P to print, or Escape to close.`;
      document.body.appendChild(announcement);

      return () => {
        document.body.removeChild(announcement);
      };
    }
  }, [isOpen, title]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;

    // Ctrl/Cmd + P to print
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      e.preventDefault();
      handlersRef.current.print();
    }

    // Escape to close
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }

    // Ctrl/Cmd + Plus/Equals to zoom in
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      handlersRef.current.zoomIn();
    }

    // Ctrl/Cmd + Minus to zoom out
    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      e.preventDefault();
      handlersRef.current.zoomOut();
    }

    // Ctrl/Cmd + 0 to reset zoom
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      setZoom(100);
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handlePrint = async () => {
    if (processingRef.current) return;

    try {
      setProcessing(true);

      if (onBeforePrint) {
        await onBeforePrint();
      }

      setTimeout(async () => {
        try {
          window.print();

          if (onAfterPrint) {
            await onAfterPrint();
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error('Print failed');
          onPrintError?.(err);
        } finally {
          setProcessing(false);
        }
      }, 100);
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Print preparation failed');
      onPrintError?.(err);
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (processingRef.current) return;
    await handlePrint();
  };

  const handleZoomIn = () => setZoom((current) => stepZoom(current, 1));

  const handleZoomOut = () => setZoom((current) => stepZoom(current, -1));

  handlersRef.current = { print: handlePrint, zoomIn: handleZoomIn, zoomOut: handleZoomOut };

  const maxWidthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    full: 'max-w-full',
  };

  if (!isOpen) return null;

  const showStateIndicator = printState !== 'idle' && printState !== 'success';

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-modal-title"
      ref={modalRef}
      id="print-content-wrapper"
      onClick={(e) => { if (e.target === e.currentTarget && !isProcessing) onClose(); }}
    >
      <div className={`bg-white rounded-lg ${maxWidthClasses[maxWidth]} w-full ${MODAL_PANEL_SCROLL} relative shadow-2xl`}>
        <div className="sticky top-0 bg-white border-b border-slate-200 p-3 sm:p-4 flex flex-wrap justify-between items-center gap-2 z-10 no-print">
          <div>
            <h2 id="print-modal-title" className="text-lg sm:text-2xl font-bold text-slate-900">{title}</h2>
            {template && (
              <p className="text-sm text-slate-600 mt-1">
                {template.orientation} • {template.size.toUpperCase()} • {template.quality}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            {showZoomControls && (
              <div className="hidden sm:flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2 bg-slate-50">
                <button
                  onClick={handleZoomOut}
                  disabled={zoom === ZOOM_LEVELS[0]}
                  className="text-slate-700 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Zoom out"
                  title="Zoom out (Ctrl/Cmd + -)"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-sm font-medium text-slate-700 w-12 text-center" aria-live="polite">
                  {zoom}%
                </span>
                <button
                  onClick={handleZoomIn}
                  disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                  className="text-slate-700 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Zoom in"
                  title="Zoom in (Ctrl/Cmd + +)"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>
            )}

            {showStateIndicator && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                {printState === 'preparing' && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <span className="text-sm text-blue-700">{printStateMessage || 'Preparing...'}</span>
                  </>
                )}
                {printState === 'printing' && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <span className="text-sm text-blue-700">{printStateMessage || 'Printing...'}</span>
                  </>
                )}
                {printState === 'error' && (
                  <>
                    <AlertCircle className="w-4 h-4 text-red-600" />
                    <span className="text-sm text-red-700">{printStateMessage || 'Error'}</span>
                  </>
                )}
                {printState === 'cancelled' && (
                  <>
                    <X className="w-4 h-4 text-orange-600" />
                    <span className="text-sm text-orange-700">Cancelled</span>
                  </>
                )}
              </div>
            )}

            {showDownloadButton && (
              <button
                onClick={handleDownload}
                disabled={isProcessing}
                className="flex items-center bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                aria-label="Download PDF"
                title="Download as PDF"
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                Download
              </button>
            )}

            <button
              ref={printButtonRef}
              onClick={handlePrint}
              disabled={isProcessing}
              className="flex items-center min-h-[44px] bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              aria-label={`${printButtonText}. Press Control P or Command P`}
              title="Print document (Ctrl/Cmd + P)"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Printer className="w-4 h-4 mr-2" />
              )}
              <span className="sm:hidden">Print</span>
              <span className="hidden sm:inline">{printButtonText}</span>
            </button>

            <button
              onClick={onClose}
              className="flex items-center min-h-[44px] bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg transition-colors"
              aria-label="Close print preview. Press Escape"
              title="Close (Escape)"
            >
              <X className="w-4 h-4 mr-2" />
              Close
            </button>
          </div>
        </div>

        <div
          className="p-4 no-print-padding transition-transform duration-200"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
        >
          {children}
        </div>

        {/* Screen reader only instructions */}
        <div className="sr-only" aria-live="polite">
          Press Control P or Command P to print. Press Escape to close. Use Control Plus to zoom in, Control Minus to zoom out.
        </div>
      </div>
    </div>
  );
}
