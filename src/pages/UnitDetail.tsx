import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { SafeStorage } from '../lib/safeStorage';
import { trackEvent, trackEventOnce } from '../lib/siteEvents';
import { notifyWarning } from '../lib/notifications';
import {
  Users,
  Maximize,
  Zap,
  Droplets,
  Home,
  Sun,
  ArrowLeft,
  ShoppingCart,
} from 'lucide-react';

interface Unit {
  id: string;
  slug: string;
  name: string;
  types: string[];
  type?: string;
  is_combo: boolean;
  price_dry_cents: number;
  price_water_cents: number | null;
  dimensions: string;
  footprint_sqft: number;
  power_circuits: number;
  capacity: number;
  indoor_ok: boolean;
  outdoor_ok: boolean;
  quantity_available: number;
  media: Array<{ url: string; alt: string }>;
}

export function UnitDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [unit, setUnit] = useState<Unit | null>(null);
  const [loading, setLoading] = useState(true);
  const [wetOrDry, setWetOrDry] = useState<'dry' | 'water'>('dry');
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);

  useEffect(() => {
    if (slug) {
      loadUnit(slug);
    }
  }, [slug]);

  async function loadUnit(unitSlug: string) {
    try {
      const { data: unitData, error: unitError } = await supabase
        .from('units')
        .select('*')
        .eq('slug', unitSlug)
        .eq('active', true)
        .maybeSingle();

      if (unitError) throw unitError;
      if (!unitData) {
        navigate('/catalog');
        return;
      }

      const { data: mediaData, error: mediaError } = await supabase
        .from('unit_media')
        .select('*')
        .eq('unit_id', unitData.id)
        .order('is_featured', { ascending: false })
        .order('sort');

      if (mediaError) throw mediaError;

      const loadedUnit = { ...unitData, media: (mediaData || []) as any } as any;
      setUnit(loadedUnit);
      trackEvent('unit_view', { unitId: unitData.id, metadata: { name: unitData.name, slug: unitData.slug } });
      const startingPriceCents = unitData.price_water_cents && unitData.price_water_cents > 0
        ? Math.min(unitData.price_dry_cents, unitData.price_water_cents)
        : unitData.price_dry_cents;
      trackEventOnce('price_preview_shown', {
        unitId: unitData.id,
        metadata: { context: 'unit_detail', price_cents: startingPriceCents },
      });
      // Auto-select water mode for water slide units
      if ((loadedUnit.types || []).includes('Water Slide') && !(loadedUnit.types || []).includes('Combo')) {
        setWetOrDry('water');
      }
    } catch (error) {
      console.error('Error loading unit:', error);
    } finally {
      setLoading(false);
    }
  }


  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-slate-600 font-medium">Loading unit details...</p>
        </div>
      </div>
    );
  }

  if (!unit) {
    return null;
  }


  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <button
          onClick={() => navigate('/catalog')}
          className="flex items-center text-slate-600 hover:text-blue-600 mb-8 sm:mb-10 transition-colors font-semibold group"
        >
          <ArrowLeft className="w-5 h-5 mr-2 group-hover:-translate-x-1 transition-transform" />
          Back to Catalog
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">
          <div>
            {/* Mode selector — only for combo units (water slides are always wet) */}
            {(unit.types || []).includes('Combo') && (
              <div className="mb-6">
                <h3 className="text-lg font-bold text-slate-900 mb-3">Select Mode</h3>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => {
                      setWetOrDry('dry');
                      setSelectedImageIndex(0);
                    }}
                    className={`flex flex-col items-center justify-center p-6 rounded-xl border-2 transition-all ${
                      wetOrDry === 'dry'
                        ? 'bg-blue-50 border-blue-600 shadow-md'
                        : 'bg-white border-slate-300 hover:border-blue-400'
                    }`}
                  >
                    <Sun className={`w-10 h-10 mb-2 ${wetOrDry === 'dry' ? 'text-blue-600' : 'text-slate-400'}`} />
                    <span className={`font-bold text-lg ${wetOrDry === 'dry' ? 'text-blue-900' : 'text-slate-600'}`}>
                      Dry
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setWetOrDry('water');
                      setSelectedImageIndex(0);
                    }}
                    className={`flex flex-col items-center justify-center p-6 rounded-xl border-2 transition-all ${
                      wetOrDry === 'water'
                        ? 'bg-blue-50 border-blue-600 shadow-md'
                        : 'bg-white border-slate-300 hover:border-blue-400'
                    }`}
                  >
                    <Droplets className={`w-10 h-10 mb-2 ${wetOrDry === 'water' ? 'text-blue-600' : 'text-slate-400'}`} />
                    <span className={`font-bold text-lg ${wetOrDry === 'water' ? 'text-blue-900' : 'text-slate-600'}`}>
                      Water
                    </span>
                  </button>
                </div>
              </div>
            )}
            {/* Water slide badge — always wet */}
            {(unit.types || []).includes('Water Slide') && !(unit.types || []).includes('Combo') && (
              <div className="mb-6 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <Droplets className="w-5 h-5 text-blue-600 flex-shrink-0" />
                <span className="text-blue-800 font-semibold text-sm">Water Slide — always used in wet mode</span>
              </div>
            )}

            {/* Main image display */}
            {(() => {
              const isWetDryUnit = (unit.types || []).includes('Combo') || (unit.types || []).includes('Water Slide');
              let filteredMedia = isWetDryUnit
                ? unit.media.filter((m: any) => m.mode === wetOrDry)
                : unit.media;

              // If wet mode selected but no wet images exist, fall back to dry images
              // (unit has "same as dry" checked in admin — no separate wet images stored)
              if (isWetDryUnit && wetOrDry === 'water' && filteredMedia.length === 0) {
                filteredMedia = unit.media.filter((m: any) => m.mode === 'dry');
              }

              const displayImage = filteredMedia[selectedImageIndex] || filteredMedia[0];

              return (
                <>
                  <div
                    className="aspect-video bg-slate-200 rounded-2xl overflow-hidden mb-4 shadow-xl border border-slate-200 cursor-pointer hover:shadow-2xl transition-shadow"
                    onClick={() => setIsImageModalOpen(true)}
                  >
                    {displayImage ? (
                      <img
                        src={displayImage.url}
                        alt={displayImage.alt}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400 font-medium">
                        No Image
                      </div>
                    )}
                  </div>

                  {filteredMedia.length > 1 && (
                    <div className="grid grid-cols-4 gap-3">
                      {filteredMedia.slice(0, 4).map((media: any, idx: number) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedImageIndex(idx)}
                          className={`aspect-video bg-slate-200 rounded-xl overflow-hidden shadow-md transition-all ${
                            selectedImageIndex === idx
                              ? 'border-4 border-blue-600 shadow-lg'
                              : 'border-2 border-slate-200 hover:border-blue-400 hover:shadow-lg'
                          }`}
                        >
                          <img
                            src={media.url}
                            alt={media.alt}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          <div>
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 mb-3 leading-tight tracking-tight">
                  {unit.name}
                </h1>
                <p className="text-lg sm:text-xl text-slate-600 font-medium">
                  {(unit.types || (unit.type ? [unit.type] : [])).join(' • ')}
                </p>
              </div>
              {((unit.types || []).includes('Combo') || (unit.types || []).includes('Water Slide')) && (
                <span className="bg-gradient-to-r from-cyan-100 to-cyan-50 text-cyan-800 text-sm font-bold px-4 py-2 rounded-xl border-2 border-cyan-200 shadow-sm">
                  WET/DRY
                </span>
              )}
            </div>

            <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-2xl p-6 sm:p-7 mb-8 shadow-lg">
              {(() => {
                const isCombo = (unit.types || []).includes('Combo');
                const isWaterOnly = (unit.types || []).includes('Water Slide') && !isCombo;
                const hasBothPrices = isCombo && unit.price_water_cents && unit.price_water_cents > 0;
                const formatDollars = (c: number) =>
                  `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

                return (
                  <>
                    <div className="flex items-baseline gap-3 mb-3 flex-wrap">
                      {hasBothPrices ? (
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-3xl sm:text-4xl font-bold text-blue-900">
                            {formatDollars(unit.price_dry_cents)}
                          </span>
                          <span className="text-base font-semibold text-blue-700">dry</span>
                          <span className="text-slate-400 font-light mx-1">/</span>
                          <span className="text-3xl sm:text-4xl font-bold text-blue-900">
                            {formatDollars(unit.price_water_cents!)}
                          </span>
                          <span className="text-base font-semibold text-blue-700">water</span>
                        </div>
                      ) : (
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-semibold text-blue-700 uppercase tracking-wide">Starting at</span>
                          <span className="text-3xl sm:text-4xl font-bold text-blue-900">
                            {formatDollars(isWaterOnly && unit.price_water_cents ? unit.price_water_cents : unit.price_dry_cents)}
                          </span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-blue-700 leading-relaxed mb-2">
                      Base rental price. Final total may vary by delivery distance, surface type, and event duration.
                    </p>
                    {(isCombo || isWaterOnly) && (
                      <p className="text-xs sm:text-sm text-blue-800 flex items-center font-semibold mt-2">
                        <Droplets className="w-4 h-4 mr-2 flex-shrink-0" />
                        {isCombo ? 'Can be used wet or dry — choose your mode below' : 'Water slide — always used wet'}
                      </p>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="grid grid-cols-2 gap-4 sm:gap-5 mb-8">
              <div className="bg-white border-2 border-slate-200 rounded-2xl p-5 shadow-md hover:shadow-lg transition-shadow">
                <div className="flex items-center text-slate-600 mb-2">
                  <Users className="w-5 h-5 mr-2 text-blue-600" />
                  <span className="text-sm font-bold">Capacity</span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold text-slate-900">{unit.capacity} kids</div>
              </div>

              <div className="bg-white border-2 border-slate-200 rounded-2xl p-5 shadow-md hover:shadow-lg transition-shadow">
                <div className="flex items-center text-slate-600 mb-2">
                  <Maximize className="w-5 h-5 mr-2 text-blue-600" />
                  <span className="text-sm font-bold">Dimensions</span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold text-slate-900">{unit.dimensions}</div>
              </div>

              <div className="bg-white border-2 border-slate-200 rounded-2xl p-5 shadow-md hover:shadow-lg transition-shadow">
                <div className="flex items-center text-slate-600 mb-2">
                  <Zap className="w-5 h-5 mr-2 text-blue-600" />
                  <span className="text-sm font-bold">Space Needed</span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold text-slate-900">
                  {unit.footprint_sqft} sq ft
                </div>
              </div>

              <div className="bg-white border-2 border-slate-200 rounded-2xl p-5 shadow-md hover:shadow-lg transition-shadow">
                <div className="flex items-center text-slate-600 mb-2">
                  <Zap className="w-5 h-5 mr-2 text-blue-600" />
                  <span className="text-sm font-bold">Power</span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold text-slate-900">
                  {unit.power_circuits} outlet{unit.power_circuits > 1 ? 's' : ''}
                </div>
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-5 mb-8 border border-slate-200">
              <div className="grid grid-cols-2 gap-5 text-sm sm:text-base">
                <div className="flex items-center">
                  <Home className="w-6 h-6 mr-3 text-slate-600" />
                  <span className="text-slate-800 font-semibold">
                    Indoor: {unit.indoor_ok ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex items-center">
                  <Sun className="w-6 h-6 mr-3 text-slate-600" />
                  <span className="text-slate-800 font-semibold">
                    Outdoor: {unit.outdoor_ok ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                const cart = SafeStorage.getItem<any[]>('bpc_cart') || [];

                // Count how many of this unit are already in cart (same unit_id and wet_or_dry)
                const existingCount = cart.filter((item: any) =>
                  item.unit_id === unit.id && item.wet_or_dry === wetOrDry
                ).length;

                // Check if we can add more
                if (existingCount >= unit.quantity_available) {
                  notifyWarning(`Sorry, we only have ${unit.quantity_available} of this item available. You already have ${existingCount} in your cart.`);
                  return;
                }

                const cartItem = {
                  unit_id: unit.id,
                  unit_name: unit.name,
                  wet_or_dry: wetOrDry,
                  unit_price_cents: wetOrDry === 'water' && unit.price_water_cents ? unit.price_water_cents : unit.price_dry_cents,
                  qty: 1,
                  is_combo: ((unit.types || []).includes('Combo') || (unit.types || []).includes('Water Slide')),
                };
                cart.push(cartItem);
                SafeStorage.setItem('bpc_cart', cart, { expirationDays: 7 });
                window.dispatchEvent(new CustomEvent('bpc-cart-updated'));
                navigate('/quote');
              }}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-5 px-6 rounded-2xl transition-all shadow-xl hover:shadow-2xl flex items-center justify-center text-lg sm:text-xl"
            >
              <ShoppingCart className="w-6 h-6 mr-3" />
              Add to Cart
            </button>

            <div className="mt-8 border-t-2 border-slate-200 pt-8">
              <h3 className="font-bold text-slate-900 mb-5 text-xl sm:text-2xl">What's Included:</h3>
              <ul className="space-y-3 text-slate-700">
                <li className="flex items-start">
                  <span className="text-green-600 mr-3 text-xl">✓</span>
                  <span className="font-medium">Delivery, setup, and pickup</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-600 mr-3 text-xl">✓</span>
                  <span className="font-medium">Professional installation by trained crew</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-600 mr-3 text-xl">✓</span>
                  <span className="font-medium">Safety stakes or sandbags (surface dependent)</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-600 mr-3 text-xl">✓</span>
                  <span className="font-medium">Blower and extension cord</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-600 mr-3 text-xl">✓</span>
                  <span className="font-medium">Safety inspection and equipment cleaning</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Image Modal */}
      {isImageModalOpen && (() => {
        const isWetDryUnitModal = (unit.types || []).includes('Combo') || (unit.types || []).includes('Water Slide');
        let filteredMedia = isWetDryUnitModal
          ? unit.media.filter((m: any) => m.mode === wetOrDry)
          : unit.media;
        if (isWetDryUnitModal && wetOrDry === 'water' && filteredMedia.length === 0) {
          filteredMedia = unit.media.filter((m: any) => m.mode === 'dry');
        }
        const displayImage = filteredMedia[selectedImageIndex] || filteredMedia[0];

        return (
          <div
            className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
            onClick={() => setIsImageModalOpen(false)}
          >
            <div className="relative max-w-7xl w-full h-full flex flex-col">
              <button
                onClick={() => setIsImageModalOpen(false)}
                className="absolute top-4 right-4 z-10 bg-white hover:bg-slate-100 text-slate-900 rounded-full p-3 shadow-lg transition-all"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <div className="flex-1 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                {displayImage && (
                  <img
                    src={displayImage.url}
                    alt={displayImage.alt}
                    className="max-w-full max-h-full object-contain"
                  />
                )}
              </div>

              {filteredMedia.length > 1 && (
                <div className="mt-4 flex justify-center gap-2 overflow-x-auto pb-4" onClick={(e) => e.stopPropagation()}>
                  {filteredMedia.map((media: any, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedImageIndex(idx)}
                      className={`flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden transition-all ${
                        selectedImageIndex === idx
                          ? 'border-4 border-blue-500 shadow-lg'
                          : 'border-2 border-white hover:border-blue-300'
                      }`}
                    >
                      <img
                        src={media.url}
                        alt={media.alt}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
