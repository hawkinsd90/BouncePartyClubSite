import { Navigation, CheckCircle, Camera, MessageCircle, Star, AlertTriangle } from 'lucide-react';

interface Props {
  isDropOff: boolean;
  isToday: boolean;
  currentStatus: string;
  processing: boolean;
  uploadingImages: boolean;
  onEnRoute: () => void;
  onArrived: () => void;
  onImageUpload: (isDamage?: boolean) => void;
  onDropOffComplete: () => void;
  onPickupComplete: () => void;
}

export function TaskDetailActions({
  isDropOff, isToday, currentStatus, processing, uploadingImages,
  onEnRoute, onArrived, onImageUpload, onDropOffComplete, onPickupComplete,
}: Props) {
  return (
    <div className="border-t border-slate-200 pt-6">
      <h3 className="font-bold text-slate-900 mb-4">Delivery Actions</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={onEnRoute}
          disabled={processing || !isToday}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
        >
          <Navigation className="w-5 h-5" />
          <span className="text-sm sm:text-base">En Route</span>
        </button>

        <button
          onClick={onArrived}
          disabled={processing || !isToday}
          className="flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
        >
          <CheckCircle className="w-5 h-5" />
          <span className="text-sm sm:text-base">Arrived</span>
        </button>

        {isDropOff ? (
          <>
            <button
              onClick={() => onImageUpload(false)}
              disabled={uploadingImages}
              className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              <Camera className="w-5 h-5" />
              <span className="text-sm sm:text-base">
                {uploadingImages ? 'Uploading...' : 'Proof Photos'}
              </span>
            </button>

            <button
              onClick={onDropOffComplete}
              disabled={processing || !isToday}
              className="flex items-center justify-center gap-2 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              <MessageCircle className="w-5 h-5" />
              <span className="text-sm sm:text-base">Leaving - Send Rules</span>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onPickupComplete}
              disabled={processing || !isToday}
              className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              <Star className="w-5 h-5" />
              <span className="text-sm sm:text-base">Complete - Ask Review</span>
            </button>

            <button
              onClick={() => onImageUpload(true)}
              disabled={uploadingImages}
              className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              <AlertTriangle className="w-5 h-5" />
              <span className="text-sm sm:text-base">
                {uploadingImages ? 'Uploading...' : 'Damage Photos'}
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
