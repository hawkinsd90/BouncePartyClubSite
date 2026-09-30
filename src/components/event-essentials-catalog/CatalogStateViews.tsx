import { AlertCircle, Loader2, Package } from 'lucide-react';

// Display-only states for EventEssentialsCatalog. The parent decides which one is shown.

export function CatalogLoadingView() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
    </div>
  );
}

export function CatalogErrorView({ error }: { error: string }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <p className="text-slate-700 mb-4">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-blue-600 hover:text-blue-700 font-semibold"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

export function CatalogEmptyProducts() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
      <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
      <p className="text-slate-600">No products are currently available in this category.</p>
    </div>
  );
}
