interface Props {
  isDropOff: boolean;
  processing: boolean;
  uploadingImages: boolean;
  onEnRoute: () => void;
  onArrived: () => void;
  onImageUpload: (isDamage?: boolean) => void;
  onDropOffComplete: () => void;
  onPickupComplete: () => void;
}

// The parent decides when to render this bar (isToday && not completed).
export function TaskDetailMobileActionBar({
  isDropOff, processing, uploadingImages,
  onEnRoute, onArrived, onImageUpload, onDropOffComplete, onPickupComplete,
}: Props) {
  return (
    <div className="sm:hidden sticky top-[60px] bg-white border-b border-slate-200 px-4 py-3 z-10 flex-shrink-0">
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onEnRoute} disabled={processing} className="flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm">En Route</button>
        <button onClick={onArrived} disabled={processing} className="flex items-center justify-center gap-1.5 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm">Arrived</button>
        {isDropOff ? (
          <>
            <button onClick={() => onImageUpload(false)} disabled={uploadingImages} className="flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm">Photos</button>
            <button onClick={onDropOffComplete} disabled={processing} className="flex items-center justify-center gap-1.5 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm">Leaving</button>
          </>
        ) : (
          <button onClick={onPickupComplete} disabled={processing} className="flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm col-span-2">Complete Pickup</button>
        )}
      </div>
    </div>
  );
}
