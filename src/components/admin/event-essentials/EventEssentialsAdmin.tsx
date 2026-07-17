import { useState } from 'react';
import { Package, Tag } from 'lucide-react';
import { ProductManager } from './ProductManager';
import { CategoryManager } from './CategoryManager';

type EETab = 'products' | 'categories';

export function EventEssentialsAdmin() {
  const [activeTab, setActiveTab] = useState<EETab>('products');

  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-2xl font-bold text-slate-900 mb-3">Event Essentials</h2>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
          <button
            onClick={() => setActiveTab('products')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'products'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Package className="w-4 h-4" />
            Products
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'categories'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Tag className="w-4 h-4" />
            Categories
          </button>
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'products' && <ProductManager />}
        {activeTab === 'categories' && <CategoryManager />}
      </div>
    </div>
  );
}
