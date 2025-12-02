import { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

interface WaiverViewerProps {
  waiverText: string;
  onScrollToBottom: (reached: boolean) => void;
  initialsRequired: string[];
  onInitialsChange: (section: string, value: string) => void;
  initials: Record<string, string>;
}

export default function WaiverViewer({
  waiverText,
  onScrollToBottom,
  initialsRequired,
  onInitialsChange,
  initials,
}: WaiverViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomMarkerRef = useRef<HTMLDivElement>(null);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

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

  const renderWaiverWithInitials = () => {
    const sections = waiverText.split('\n\n');
    return sections.map((section, index) => {
      const needsInitials = initialsRequired.find((req) =>
        section.toLowerCase().includes(req.toLowerCase())
      );

      return (
        <div key={index} className="mb-6">
          <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{section}</p>
          {needsInitials && (
            <div className="mt-3 flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <label className="text-sm font-medium text-gray-700">
                Initial here to acknowledge "{needsInitials}":
              </label>
              <input
                type="text"
                maxLength={4}
                value={initials[needsInitials] || ''}
                onChange={(e) =>
                  onInitialsChange(needsInitials, e.target.value.toUpperCase())
                }
                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-center font-semibold uppercase"
                placeholder="AB"
              />
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="border-2 border-gray-300 rounded-lg p-6 h-96 overflow-y-auto bg-white"
      >
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          Liability Waiver and Rental Agreement
        </h2>
        <div className="text-sm text-gray-600 mb-6">
          Version 1.0 | Effective Date: December 2, 2025
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
          ⚠ Please scroll to the bottom to continue
        </div>
      )}
    </div>
  );
}
