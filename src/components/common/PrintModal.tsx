import { Printer, X, Download } from 'lucide-react';
import { ReactNode } from 'react';

interface PrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  onBeforePrint?: () => void;
  onAfterPrint?: () => void;
  printButtonText?: string;
  showDownloadButton?: boolean;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | 'full';
}

export function PrintModal({
  isOpen,
  onClose,
  title = 'Print Preview',
  children,
  onBeforePrint,
  onAfterPrint,
  printButtonText = 'Print / Save PDF',
  showDownloadButton = false,
  maxWidth = '5xl',
}: PrintModalProps) {
  if (!isOpen) return null;

  const handlePrint = () => {
    onBeforePrint?.();
    setTimeout(() => {
      window.print();
      onAfterPrint?.();
    }, 100);
  };

  const handleDownload = () => {
    onBeforePrint?.();
    setTimeout(() => {
      window.print();
      onAfterPrint?.();
    }, 100);
  };

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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto no-print">
      <div className={`bg-white rounded-lg ${maxWidthClasses[maxWidth]} w-full max-h-[90vh] overflow-y-auto relative shadow-2xl`}>
        <div className="sticky top-0 bg-white border-b border-slate-200 p-4 flex justify-between items-center z-10 no-print">
          <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
          <div className="flex gap-2">
            {showDownloadButton && (
              <button
                onClick={handleDownload}
                className="flex items-center bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                aria-label="Download PDF"
              >
                <Download className="w-4 h-4 mr-2" />
                Download
              </button>
            )}
            <button
              onClick={handlePrint}
              className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              aria-label={printButtonText}
            >
              <Printer className="w-4 h-4 mr-2" />
              {printButtonText}
            </button>
            <button
              onClick={onClose}
              className="flex items-center bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 mr-2" />
              Close
            </button>
          </div>
        </div>
        <div className="p-4 no-print-padding">{children}</div>
      </div>
    </div>
  );
}
