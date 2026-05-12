import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react';

export function sectionInitialId(section: string): string {
  return `initial-${section.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

export interface WaiverViewerHandle {
  scrollToNextIncompleteInitial: () => boolean;
}

interface WaiverViewerProps {
  waiverText: string;
  onScrollToBottom: (reached: boolean) => void;
  initialsRequired: string[];
  onInitialsChange: (section: string, value: string) => void;
  initials: Record<string, string>;
}

const WaiverViewer = forwardRef<WaiverViewerHandle, WaiverViewerProps>(function WaiverViewer(
  { waiverText, onScrollToBottom, initialsRequired, onInitialsChange, initials },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomMarkerRef = useRef<HTMLDivElement>(null);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

  const completedCount = initialsRequired.filter(
    (s) => (initials[s] || '').trim().length >= 2
  ).length;
  const allComplete = completedCount === initialsRequired.length;

  const nextIncompleteSection = initialsRequired.find(
    (s) => (initials[s] || '').trim().length < 2
  );

  useImperativeHandle(ref, () => ({
    scrollToNextIncompleteInitial() {
      if (!nextIncompleteSection) return false;
      const inputId = sectionInitialId(nextIncompleteSection);
      const container = containerRef.current;
      const el = document.getElementById(inputId);
      if (!el || !container) return false;

      // Scroll the inner container so the element is visible
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const offset = elRect.top - containerRect.top + container.scrollTop - 60;
      container.scrollTo({ top: offset, behavior: 'smooth' });

      // Focus the input after a short delay to let the scroll settle
      setTimeout(() => {
        const input = document.getElementById(`${inputId}-input`) as HTMLInputElement | null;
        if (input) input.focus();
      }, 350);

      return true;
    },
  }));

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && !hasScrolledToBottom) {
          setHasScrolledToBottom(true);
          onScrollToBottom(true);
        }
      },
      {
        root: containerRef.current,
        threshold: 1.0,
      }
    );

    if (bottomMarkerRef.current) {
      observer.observe(bottomMarkerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [hasScrolledToBottom, onScrollToBottom]);

  const renderInitialsBlock = (sectionKey: string) => {
    const inputId = sectionInitialId(sectionKey);
    const isSigned = (initials[sectionKey] || '').trim().length >= 2;

    return (
      <div
        id={inputId}
        key={`initials-${sectionKey}`}
        className={`mt-4 mb-2 rounded-xl border-2 p-4 ${
          isSigned
            ? 'bg-green-50 border-green-400'
            : 'bg-amber-50 border-amber-500'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex-shrink-0 rounded-full p-1 ${isSigned ? 'bg-green-100' : 'bg-amber-100'}`}>
            {isSigned ? (
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-600 animate-pulse" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-bold mb-1 ${isSigned ? 'text-green-800' : 'text-amber-900'}`}>
              {isSigned ? 'Initials confirmed' : 'Required — initial here to continue'}
            </p>
            <p className={`text-xs mb-3 ${isSigned ? 'text-green-700' : 'text-amber-800'}`}>
              Acknowledging: <span className="font-semibold">{sectionKey}</span>
            </p>
            <div className="flex items-center gap-3">
              <label htmlFor={`${inputId}-input`} className="text-sm font-semibold text-gray-700 whitespace-nowrap">
                Your initials:
              </label>
              <input
                id={`${inputId}-input`}
                type="text"
                maxLength={4}
                value={initials[sectionKey] || ''}
                onChange={(e) => onInitialsChange(sectionKey, e.target.value.toUpperCase())}
                className={`w-24 px-3 py-3 border-2 rounded-lg text-center font-bold text-lg uppercase tracking-widest focus:outline-none focus:ring-2 ${
                  isSigned
                    ? 'border-green-400 bg-green-50 text-green-800 focus:ring-green-400'
                    : 'border-amber-500 bg-white text-gray-900 focus:ring-amber-400'
                }`}
                placeholder="AB"
                aria-label={`Initials for ${sectionKey}`}
              />
              {isSigned && (
                <span className="text-sm font-semibold text-green-700">
                  Signed
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderWaiverWithInitials = () => {
    const sections = waiverText.split('\n\n');
    const renderedSections: JSX.Element[] = [];
    let currentSectionNeedsInitials: string | undefined;
    let currentSectionElements: JSX.Element[] = [];
    let currentSectionIndex = 0;

    sections.forEach((section, index) => {
      const needsInitials = initialsRequired.find((req) =>
        section.toLowerCase().includes(req.toLowerCase())
      );

      const isHeader = /^\d+\.\s+[A-Z\s]+$/.test(section.trim());

      if (isHeader && currentSectionNeedsInitials && currentSectionElements.length > 0) {
        const sectionKey = currentSectionNeedsInitials;
        renderedSections.push(
          <div key={`section-${currentSectionIndex}`} className="mb-6">
            {currentSectionElements}
            {renderInitialsBlock(sectionKey)}
          </div>
        );
        currentSectionElements = [];
        currentSectionNeedsInitials = undefined;
        currentSectionIndex++;
      }

      if (isHeader) {
        currentSectionElements.push(
          <p key={`${currentSectionIndex}-${index}`} className="text-gray-900 font-bold text-lg leading-relaxed whitespace-pre-wrap mb-3">
            {section}
          </p>
        );
        if (needsInitials) {
          currentSectionNeedsInitials = needsInitials;
        }
      } else {
        currentSectionElements.push(
          <p key={`${currentSectionIndex}-${index}`} className="text-gray-800 leading-relaxed whitespace-pre-wrap mb-3">
            {section}
          </p>
        );
      }
    });

    if (currentSectionElements.length > 0) {
      const finalSectionKey = currentSectionNeedsInitials;
      renderedSections.push(
        <div key={`section-${currentSectionIndex}`} className="mb-6">
          {currentSectionElements}
          {finalSectionKey && renderInitialsBlock(finalSectionKey)}
        </div>
      );
    }

    return renderedSections;
  };

  return (
    <div className="space-y-3">
      {/* Initials progress panel */}
      <div className={`rounded-xl border-2 p-4 ${allComplete ? 'bg-green-50 border-green-400' : 'bg-amber-50 border-amber-400'}`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            {allComplete ? (
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            )}
            <span className={`font-bold text-sm ${allComplete ? 'text-green-800' : 'text-amber-900'}`}>
              Required initials: {completedCount} of {initialsRequired.length} complete
            </span>
          </div>
          {!allComplete && (
            <button
              type="button"
              onClick={() => {
                const container = containerRef.current;
                if (!nextIncompleteSection || !container) return;
                const inputId = sectionInitialId(nextIncompleteSection);
                const el = document.getElementById(inputId);
                if (!el) return;
                const containerRect = container.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();
                const offset = elRect.top - containerRect.top + container.scrollTop - 60;
                container.scrollTo({ top: offset, behavior: 'smooth' });
                setTimeout(() => {
                  const input = document.getElementById(`${inputId}-input`) as HTMLInputElement | null;
                  if (input) input.focus();
                }, 350);
              }}
              className="flex items-center gap-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors flex-shrink-0 whitespace-nowrap"
            >
              Go to next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <ul className="space-y-1.5">
          {initialsRequired.map((section) => {
            const done = (initials[section] || '').trim().length >= 2;
            return (
              <li key={section} className="flex items-center gap-2">
                {done ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-amber-500 flex-shrink-0" />
                )}
                <span className={`text-sm ${done ? 'text-green-700 line-through' : 'text-amber-900 font-medium'}`}>
                  {section}
                </span>
                {!done && (
                  <button
                    type="button"
                    onClick={() => {
                      const container = containerRef.current;
                      if (!container) return;
                      const inputId = sectionInitialId(section);
                      const el = document.getElementById(inputId);
                      if (!el) return;
                      const containerRect = container.getBoundingClientRect();
                      const elRect = el.getBoundingClientRect();
                      const offset = elRect.top - containerRect.top + container.scrollTop - 60;
                      container.scrollTo({ top: offset, behavior: 'smooth' });
                      setTimeout(() => {
                        const input = document.getElementById(`${inputId}-input`) as HTMLInputElement | null;
                        if (input) input.focus();
                      }, 350);
                    }}
                    className="ml-auto text-xs text-amber-700 hover:text-amber-900 underline font-medium"
                  >
                    Go
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Waiver scroll container */}
      <div className="relative">
        <div
          ref={containerRef}
          className="border-2 border-gray-300 rounded-lg p-6 h-96 overflow-y-auto bg-white"
        >
          <div className="flex flex-col items-center mb-6">
            <img
              src="/bounce party club logo.png"
              alt="Bounce Party Club"
              className="h-20 w-auto mb-4"
            />
            <h2 className="text-2xl font-bold text-gray-900 text-center">
              Liability Waiver and Rental Agreement
            </h2>
            <div className="text-sm text-gray-600 mt-1 text-center">
              Version 1.0 | Effective Date: December 2, 2025
            </div>
          </div>
          {renderWaiverWithInitials()}
          <div ref={bottomMarkerRef} className="h-1" />
        </div>
        {hasScrolledToBottom && (
          <div className="absolute top-4 right-4 bg-green-100 border border-green-300 rounded-lg px-3 py-2 flex items-center gap-2 shadow-sm">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <span className="text-sm font-medium text-green-800">Read completely</span>
          </div>
        )}
        {!hasScrolledToBottom && (
          <div className="mt-2 text-sm text-orange-600 font-medium">
            Please scroll to the bottom of the waiver to continue
          </div>
        )}
      </div>
    </div>
  );
});

export default WaiverViewer;
