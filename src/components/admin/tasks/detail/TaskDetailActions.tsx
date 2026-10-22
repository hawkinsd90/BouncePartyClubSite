import { Navigation, CheckCircle, Camera, MessageCircle, Star, AlertTriangle, Upload } from 'lucide-react';

import { buttonLabel, completionDisabled, workingLabel, type TaskBusyAction } from '../../../../lib/tasks/taskProgress';

interface Props {
  isDropOff: boolean;
  isToday: boolean;
  currentStatus: string;
  processing: boolean;
  uploadingImages: boolean;
  uploadCount?: number;
  onEnRoute: () => void;
  onArrived: () => void;
  onImageUpload: (isDamage?: boolean) => void;
  onDropOffComplete: () => void;
  onPickupComplete: () => void;
  onPaperWaiverUpload: () => void;
  busyAction?: TaskBusyAction | null;
}

// The paper-waiver upload button is intentionally switched off until physical waiver upload is implemented.
const PAPER_WAIVER_UPLOAD_ENABLED = false as boolean;

export function TaskDetailActions({
  isDropOff, isToday, currentStatus: _currentStatus, processing, uploadingImages, uploadCount,
  onEnRoute, onArrived, onImageUpload, onDropOffComplete, onPickupComplete, onPaperWaiverUpload,
  busyAction = null,
}: Props) {
  const working = workingLabel(busyAction, uploadingImages, uploadCount);
  return (
    <div className="border-t border-slate-200 pt-6">
      <h3 className="font-bold text-slate-900 mb-4">{isDropOff ? 'Delivery Actions' : 'Pickup Actions'}</h3>
      {working && <p role="status" className="text-sm font-semibold text-slate-600 mb-3">{working}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={onEnRoute}
          disabled={processing || !isToday}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
        >
          <Navigation className="w-5 h-5" />
          <span className="text-sm sm:text-base">{buttonLabel('En Route', 'Working...', busyAction === 'en_route')}</span>
        </button>

        <button
          onClick={onArrived}
          disabled={processing || !isToday}
          className="flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
        >
          <CheckCircle className="w-5 h-5" />
          <span className="text-sm sm:text-base">{buttonLabel('Arrived', 'Working...', busyAction === 'arrived')}</span>
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
              disabled={completionDisabled({ processing, isToday, uploadingImages })}
              className="flex items-center justify-center gap-2 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              <MessageCircle className="w-5 h-5" />
              <span className="text-sm sm:text-base">{buttonLabel('Leaving - Send Rules', 'Working...', busyAction === 'drop_off')}</span>
            </button>

            {/* Upload Paper Waiver — TODO: enable when physical waiver upload is implemented */}
            {PAPER_WAIVER_UPLOAD_ENABLED && (
              <button
                onClick={onPaperWaiverUpload}
                className="flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 px-4 rounded-lg border border-slate-300 transition-colors sm:col-span-2"
              >
                <Upload className="w-5 h-5" />
                <span className="text-sm sm:text-base">Upload Paper Waiver</span>
              </button>
            )}
          </>
        ) : (
          <>
            <button
              onClick={onPickupComplete}
              disabled={completionDisabled({ processing, isToday, uploadingImages })}
              className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              <Star className="w-5 h-5" />
              <span className="text-sm sm:text-base">{buttonLabel('Complete - Ask Review', 'Working...', busyAction === 'pickup')}</span>
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
