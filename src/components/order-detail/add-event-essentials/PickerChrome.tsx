import { X } from 'lucide-react';

// Display-only chrome for AddEventEssentialsSection. The parent keeps every setter,
// toggle decision, async call and the render conditions for the pickers.

export function PickerBanners({ error, availabilityError }: { error: string | null; availabilityError: string | null }) {
  return (
    <>
      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {availabilityError && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm text-amber-800">{availabilityError}</p>
        </div>
      )}
    </>
  );
}

export function PickerSpinners({ loading, availabilityChecking }: { loading: boolean; availabilityChecking: boolean }) {
  return (
    <>
      {loading && (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-600"></div>
          Loading catalog...
        </div>
      )}

      {availabilityChecking && (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-600"></div>
          Checking availability...
        </div>
      )}
    </>
  );
}

export function PickerHeader({ title, onDone }: { title: string; onDone: () => void }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h4 className="font-medium text-slate-900">{title}</h4>
      <button
        onClick={onDone}
        className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <X className="w-3 h-3" />
        Done
      </button>
    </div>
  );
}

export function PickerCategoryPills({
  categories,
  selectedCategoryId,
  onSelect,
}: {
  categories: { id: string; name: string }[];
  selectedCategoryId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      <button
        onClick={() => onSelect(null)}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
          selectedCategoryId === null
            ? 'bg-slate-800 text-white'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
        }`}
      >
        All
      </button>
      {categories.map(cat => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.id)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            selectedCategoryId === cat.id
              ? 'bg-slate-800 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}
