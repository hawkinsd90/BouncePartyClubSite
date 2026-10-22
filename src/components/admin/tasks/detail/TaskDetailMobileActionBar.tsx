import { buttonLabel, workingLabel, type TaskBusyAction } from '../../../../lib/tasks/taskProgress';

interface Props {
  isDropOff: boolean;
  processing: boolean;
  uploadingImages: boolean;
  onEnRoute: () => void;
  onArrived: () => void;
  onImageUpload: (isDamage?: boolean) => void;
  onDropOffComplete: () => void;
  onPickupComplete: () => void;
  busyAction?: TaskBusyAction | null;
}

// The parent decides when to render this bar (isToday && not completed).
export function TaskDetailMobileActionBar({
  isDropOff, processing, uploadingImages,
  onEnRoute, onArrived, onImageUpload, onDropOffComplete, onPickupComplete, busyAction = null,
}: Props) {
  const working = workingLabel(busyAction, uploadingImages);
  return (
    <div className="sm:hidden bg-white border-b border-slate-200 px-4 py-3">
      {working && <p role="status" className="text-xs font-semibold text-slate-600 mb-2">{working}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onEnRoute} disabled={processing} className="flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm">{buttonLabel('En Route', 'Working...', busyAction === 'en_route')}</button>
        <button onClick={onArrived} disabled={processing} className="flex items-center justify-center gap-1.5 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm">{buttonLabel('Arrived', 'Working...', busyAction === 'arrived')}</button>
        {isDropOff ? (
          <>
            <button onClick={() => onImageUpload(false)} disabled={uploadingImages} className="flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm">{buttonLabel('Photos', 'Uploading...', uploadingImages)}</button>
            <button onClick={onDropOffComplete} disabled={processing} className="flex items-center justify-center gap-1.5 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm">{buttonLabel('Leaving', 'Working...', busyAction === 'drop_off')}</button>
          </>
        ) : (
          <button onClick={onPickupComplete} disabled={processing} className="flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm col-span-2">{buttonLabel('Complete Pickup', 'Working...', busyAction === 'pickup')}</button>
        )}
      </div>
    </div>
  );
}
