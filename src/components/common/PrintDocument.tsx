import { ReactNode } from 'react';

export type PrintOrientation = 'portrait' | 'landscape';
export type PrintSize = 'letter' | 'a4' | 'legal';

interface PrintDocumentProps {
  children: ReactNode;
  orientation?: PrintOrientation;
  size?: PrintSize;
  showHeader?: boolean;
  showFooter?: boolean;
  headerContent?: ReactNode;
  footerContent?: ReactNode;
  className?: string;
}

export function PrintDocument({
  children,
  orientation = 'portrait',
  size = 'letter',
  showHeader = false,
  showFooter = false,
  headerContent,
  footerContent,
  className = '',
}: PrintDocumentProps) {
  const orientationClass = orientation === 'landscape' ? 'print-landscape' : 'print-portrait';
  const sizeClass = `print-${size}`;

  return (
    <div className={`print-document ${orientationClass} ${sizeClass} ${className}`}>
      {showHeader && headerContent && (
        <div className="print-header hidden print:block mb-4 pb-4 border-b border-slate-300">
          {headerContent}
        </div>
      )}

      <div className="print-content">{children}</div>

      {showFooter && footerContent && (
        <div className="print-footer hidden print:block mt-4 pt-4 border-t border-slate-300">
          {footerContent}
        </div>
      )}

      <style>{`
        @media print {
          .print-document {
            width: 100%;
            margin: 0;
            padding: 0;
          }

          .print-portrait {
            size: ${size} portrait;
          }

          .print-landscape {
            size: ${size} landscape;
          }

          .print-letter {
            width: 8.5in;
          }

          .print-a4 {
            width: 210mm;
          }

          .print-legal {
            width: 8.5in;
          }

          .no-print,
          .no-print * {
            display: none !important;
          }

          .no-print-padding {
            padding: 0 !important;
          }

          body {
            margin: 0;
            padding: 0;
          }

          @page {
            margin: 0.5in;
          }
        }

        @media screen {
          .print-document {
            background: white;
            padding: 2rem;
            min-height: 11in;
          }
        }
      `}</style>
    </div>
  );
}
