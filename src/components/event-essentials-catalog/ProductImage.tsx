import { ImageOff } from 'lucide-react';

interface Props {
  imageUrl: string | null | undefined;
  alt: string;
}

// Display only. The onError handler hides the failed image and reveals the hidden
// placeholder sibling that follows it, so the JSX order below is load-bearing.
export function ProductImage({ imageUrl, alt }: Props) {
  return (
    <div className="mb-3 aspect-video rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={alt}
          className="w-full h-full object-cover"
          onError={(e) => {
            const target = e.currentTarget;
            target.style.display = 'none';
            target.nextElementSibling?.classList.remove('hidden');
          }}
        />
      ) : null}
      {(!imageUrl) && (
        <div className="flex flex-col items-center justify-center text-slate-400">
          <ImageOff className="w-8 h-8 mb-1" />
          <span className="text-xs">No image</span>
        </div>
      )}
      {imageUrl && (
        <div className="hidden flex-col items-center justify-center text-slate-400">
          <ImageOff className="w-8 h-8 mb-1" />
          <span className="text-xs">No image</span>
        </div>
      )}
    </div>
  );
}
