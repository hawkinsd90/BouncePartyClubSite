import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, Tag, Layers } from 'lucide-react';
import { ProductManager } from './ProductManager';
import { CategoryManager } from './CategoryManager';
import { PackageManager } from './PackageManager';

type EETab = 'products' | 'categories' | 'packages';

const VALID_EE_TABS: EETab[] = ['products', 'categories', 'packages'];

function isValidEETab(v: string | null): v is EETab {
  return v !== null && VALID_EE_TABS.includes(v as EETab);
}

export function EventEssentialsAdmin() {
  const [searchParams, setSearchParams] = useSearchParams();

  const paramTab = searchParams.get('eventEssentialsTab');
  const [activeTab, setActiveTab] = useState<EETab>(
    isValidEETab(paramTab) ? paramTab : 'products',
  );

  useEffect(() => {
    const v = searchParams.get('eventEssentialsTab');
    if (isValidEETab(v) && v !== activeTab) {
      setActiveTab(v);
    } else if (!isValidEETab(v) && activeTab !== 'products') {
      setActiveTab('products');
    }
  }, [searchParams]);

  function handleTabChange(tab: EETab) {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set('eventEssentialsTab', tab);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-2xl font-bold text-slate-900 mb-3">Event Essentials</h2>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
          <button
            onClick={() => handleTabChange('products')}
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
            onClick={() => handleTabChange('categories')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'categories'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Tag className="w-4 h-4" />
            Categories
          </button>
          <button
            onClick={() => handleTabChange('packages')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'packages'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-4 h-4" />
            Packages
          </button>
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'products' && <ProductManager />}
        {activeTab === 'categories' && <CategoryManager />}
        {activeTab === 'packages' && <PackageManager />}
      </div>
    </div>
  );
}
