import { MoveUp, MoveDown, CreditCard as Edit2, Trash2 } from 'lucide-react';
import type { CarouselMedia } from './carouselTypes';

interface CarouselEditModeProps {
  media: CarouselMedia[];
  onEdit: (item: CarouselMedia) => void;
  onDelete: (id: string, storagePath: string | null) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
}

export function CarouselEditMode({ media, onEdit, onDelete, onMove }: CarouselEditModeProps) {
  return (
    <div className="mt-4 space-y-2">
      {media.map((item, index) => (
        <div key={item.id} className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4">
          <div className="flex items-start gap-3 sm:gap-4">
            {item.media_type === 'video' ? (
              <video
                src={item.image_url}
                className="w-16 h-12 sm:w-24 sm:h-16 object-cover rounded flex-shrink-0"
                muted
              />
            ) : (
              <img
                src={item.image_url}
                alt={item.title || 'Carousel media'}
                className="w-16 h-12 sm:w-24 sm:h-16 object-cover rounded flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-medium text-sm sm:text-base truncate">{item.title || 'Untitled'}</p>
                <span className="text-xs px-2 py-0.5 bg-slate-100 rounded flex-shrink-0">
                  {item.media_type}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 line-clamp-2">{item.description || 'No description'}</p>

              <div className="flex sm:hidden items-center gap-1 mt-2">
                <button
                  onClick={() => onMove(item.id, 'up')}
                  disabled={index === 0}
                  className="p-1.5 text-slate-600 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Move up"
                >
                  <MoveUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onMove(item.id, 'down')}
                  disabled={index === media.length - 1}
                  className="p-1.5 text-slate-600 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Move down"
                >
                  <MoveDown className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onEdit(item)}
                  className="inline-flex items-center px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-xs"
                  aria-label="Edit"
                >
                  <Edit2 className="w-3 h-3 mr-1" />
                  Edit
                </button>
                <button
                  onClick={() => onDelete(item.id, item.storage_path)}
                  className="inline-flex items-center px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-xs"
                  aria-label="Delete"
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  Delete
                </button>
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => onMove(item.id, 'up')}
                disabled={index === 0}
                className="p-2 text-slate-600 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Move up"
              >
                <MoveUp className="w-4 h-4" />
              </button>
              <button
                onClick={() => onMove(item.id, 'down')}
                disabled={index === media.length - 1}
                className="p-2 text-slate-600 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Move down"
              >
                <MoveDown className="w-4 h-4" />
              </button>
              <button
                onClick={() => onEdit(item)}
                className="inline-flex items-center px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-xs"
                aria-label="Edit"
              >
                <Edit2 className="w-3 h-3 mr-1" />
                Edit
              </button>
              <button
                onClick={() => onDelete(item.id, item.storage_path)}
                className="inline-flex items-center px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-xs"
                aria-label="Delete"
              >
                <Trash2 className="w-3 h-3 mr-1" />
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
