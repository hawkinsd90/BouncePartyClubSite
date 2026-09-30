import { Trash2 } from 'lucide-react';

interface Props {
  inCartQty: number;
  onRemove: () => void;
}

// Display only. The parent decides when to render this (inCartQty > 0) and owns the removal.
export function RemoveFromCartRow({ inCartQty, onRemove }: Props) {
  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <p className="text-xs font-medium text-slate-600 mb-2">
        In cart: {inCartQty}
      </p>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 font-medium rounded-lg text-xs transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Remove from Cart
      </button>
    </div>
  );
}
