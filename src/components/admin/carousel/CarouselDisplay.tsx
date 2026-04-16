import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CarouselMedia } from './carouselTypes';

interface CarouselDisplayProps {
  media: CarouselMedia[];
  currentIndex: number;
  onPrevious: () => void;
  onNext: () => void;
  onGoToSlide: (index: number) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
}

export function CarouselDisplay({
  media,
  currentIndex,
  onPrevious,
  onNext,
  onGoToSlide,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}: CarouselDisplayProps) {
  return (
    <div className="relative sm:rounded-xl overflow-hidden shadow-none sm:shadow-2xl">
      <div
        className="relative w-full"
        style={{ aspectRatio: '16/9', maxHeight: '600px' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {media.map((item, index) => (
          <div
            key={item.id}
            className={`absolute inset-0 transition-opacity duration-1000 ${
              index === currentIndex ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {item.media_type === 'video' ? (
              <video
                src={item.image_url}
                className="w-full h-full object-cover"
                autoPlay
                loop
                muted
                playsInline
              />
            ) : (
              <img
                src={item.image_url}
                alt={item.title || 'Carousel media'}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            {(item.title || item.description) && (
              <div className="absolute bottom-0 left-0 right-0 pb-10 sm:pb-12 px-4 sm:px-8 text-white">
                {item.title && (
                  <h3 className="text-xl sm:text-3xl lg:text-4xl font-bold mb-1 sm:mb-2 drop-shadow-md">{item.title}</h3>
                )}
                {item.description && (
                  <p className="text-sm sm:text-lg lg:text-xl text-white/90 drop-shadow">{item.description}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {media.length > 1 && (
        <>
          <button
            onClick={onPrevious}
            className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white p-2.5 rounded-full transition-all backdrop-blur-sm items-center justify-center"
            aria-label="Previous slide"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={onNext}
            className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white p-2.5 rounded-full transition-all backdrop-blur-sm items-center justify-center"
            aria-label="Next slide"
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          <div className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 sm:gap-2">
            {media.map((_, index) => (
              <button
                key={index}
                onClick={() => onGoToSlide(index)}
                className={`h-1.5 sm:h-2 rounded-full transition-all duration-300 ${
                  index === currentIndex
                    ? 'bg-white w-6 sm:w-8'
                    : 'bg-white/50 hover:bg-white/75 w-1.5 sm:w-2'
                }`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
