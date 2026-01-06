import { ReactNode } from 'react';
import {
  PrintOrientation,
  PrintSize,
  PrintDocumentType,
  PRINT_TEMPLATES,
} from '../../lib/printUtils';

interface PrintDocumentProps {
  children: ReactNode;
  orientation?: PrintOrientation;
  size?: PrintSize;
  showHeader?: boolean;
  showFooter?: boolean;
  headerContent?: ReactNode;
  footerContent?: ReactNode;
  className?: string;
  documentType?: PrintDocumentType;
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
  documentType,
}: PrintDocumentProps) {
  // Use template if documentType is provided
  const template = documentType ? PRINT_TEMPLATES[documentType] : null;

  const finalOrientation = template?.orientation || orientation;
  const finalSize = template?.size || size;
  const finalShowHeader = template?.showHeader ?? showHeader;
  const finalShowFooter = template?.showFooter ?? showFooter;
  const margins = template?.margins || '0.5in';

  const orientationClass = finalOrientation === 'landscape' ? 'print-landscape' : 'print-portrait';
  const sizeClass = `print-${finalSize}`;

  return (
    <div className={`print-document ${orientationClass} ${sizeClass} ${className}`}>
      {finalShowHeader && headerContent && (
        <div className="print-header hidden print:block mb-4 pb-4 border-b border-slate-300">
          {headerContent}
        </div>
      )}

      <div className="print-content">{children}</div>

      {finalShowFooter && footerContent && (
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
            size: ${finalSize} portrait;
          }

          .print-landscape {
            size: ${finalSize} landscape;
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
            margin: ${margins};
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
