import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { SafeStorage } from '../lib/core/safeStorage';
import { trackEvent } from '../lib/core/siteEvents';
import { notifyWarning } from '../lib/toasts';
import { stepIndex, swipeDirection } from '../lib/core/swipe';
import { useBodyScrollLock } from '../hooks/core/useBodyScrollLock';
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
  media: Array<{ url: string; alt: string; mode?: string | null; visibility_mode?: string | null; is_featured?: boolean | null; sort?: number | null }>;
}

export function UnitDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [unit, setUnit] = useState<Unit | null>(null);
  const [loading, setLoading] = useState(true);
  const [wetOrDry, setWetOrDry] = useState<'dry' | 'water'>('dry');
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  // A failed load used to leave a blank page; it is shown, with a way to try again.
  const [loadError, setLoadError] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  useBodyScrollLock(isImageModalOpen);

  useEffect(() => {
    if (slug) {
      loadUnit(slug);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the id / route parameter; the loader reads only that value
  }, [slug]);

  // Escape closes the photo viewer.
  useEffect(() => {
    if (!isImageModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsImageModalOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isImageModalOpen]);

  async function loadUnit(unitSlug: string) {
    setLoadError(false);
    setLoading(true);
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

      // unitData is the units row (select *) and `media` its unit_media rows, which is the Unit shape above
      const loadedUnit = { ...unitData, media: mediaData || [] } as unknown as Unit;
      setUnit(loadedUnit);
      trackEvent('unit_view', { unitId: unitData.id, metadata: { name: unitData.name, slug: unitData.slug } });
      // Auto-select water mode for water slide units
      if ((loadedUnit.types || []).includes('Water Slide') && !(loadedUnit.types || []).includes('Combo')) {
        setWetOrDry('water');
      }
    } catch (error) {
      console.error('Error loading unit:', error);
      setLoadError(true);
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

  if (loadError) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div role="alert" className="max-w-md mx-auto bg-red-50 border-2 border-red-300 rounded-2xl p-6 text-center">
          <h1 className="text-xl font-bold text-red-900 mb-2">We could not load this inflatable</h1>
          <p className="text-sm text-red-800 mb-5">Check your connection and try again.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button type="button" onClick={() => slug && loadUnit(slug)} className="min-h-[48px] px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl">Try again</button>
            <button type="button" onClick={() => navigate('/catalog')} className="min-h-[48px] px-6 bg-white border border-slate-300 text-slate-700 font-semibold rounded-xl">Back to Catalog</button>
          </div>
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
                    className={`flex flex-col items-center justify-center p-4 sm:p-6 min-h-[48px] rounded-xl border-2 transition-all ${
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
                    className={`flex flex-col items-center justify-center p-4 sm:p-6 min-h-[48px] rounded-xl border-2 transition-all ${
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
                ? unit.media.filter((m) => m.mode === wetOrDry || m.visibility_mode === 'both')
                : unit.media;

              if (isWetDryUnit && wetOrDry === 'water' && filteredMedia.length === 0) {
                filteredMedia = unit.media.filter((m) => m.mode === 'dry');
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
                      {filteredMedia.slice(0, 4).map((media, idx) => (
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
            <div className="flex items-start justify-between gap-3 mb-6">
              <div className="min-w-0">
                <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold text-slate-900 mb-3 leading-tight tracking-tight break-words">
                  {unit.name}
                </h1>
                <p className="text-lg sm:text-xl text-slate-600 font-medium">
                  {(unit.types || (unit.type ? [unit.type] : [])).join(' • ')}
                </p>
              </div>
              {((unit.types || []).includes('Combo') || (unit.types || []).includes('Water Slide')) && (
                <span className="flex-shrink-0 bg-gradient-to-r from-cyan-100 to-cyan-50 text-cyan-800 text-xs sm:text-sm font-bold px-3 sm:px-4 py-2 rounded-xl border-2 border-cyan-200 shadow-sm">
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
              <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 sm:p-5 shadow-md hover:shadow-lg transition-shadow min-w-0">
                <div className="flex items-center text-slate-600 mb-2">
                  <Users className="w-5 h-5 mr-2 text-blue-600" />
                  <span className="text-sm font-bold">Capacity</span>
                </div>
                <div className="text-xl sm:text-3xl font-bold text-slate-900 break-words">{unit.capacity} kids</div>
              </div>

              <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 sm:p-5 shadow-md hover:shadow-lg transition-shadow min-w-0">
                <div className="flex items-center text-slate-600 mb-2">
                  <Maximize className="w-5 h-5 mr-2 text-blue-600" />
                  <span className="text-sm font-bold">Dimensions</span>
                </div>
                <div className="text-xl sm:text-3xl font-bold text-slate-900 break-words">{unit.dimensions}</div>
              </div>

              <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 sm:p-5 shadow-md hover:shadow-lg transition-shadow min-w-0">
                <div className="flex items-center text-slate-600 mb-2">
                  <Zap className="w-5 h-5 mr-2 text-blue-600" />
                  <span className="text-sm font-bold">Space Needed</span>
                </div>
                <div className="text-xl sm:text-3xl font-bold text-slate-900 break-words">
                  {unit.footprint_sqft} sq ft
                </div>
              </div>

              <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 sm:p-5 shadow-md hover:shadow-lg transition-shadow min-w-0">
                <div className="flex items-center text-slate-600 mb-2">
                  <Zap className="w-5 h-5 mr-2 text-blue-600" />
                  <span className="text-sm font-bold">Power</span>
                </div>
                <div className="text-xl sm:text-3xl font-bold text-slate-900 break-words">
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
                const cart = SafeStorage.getItem<Array<{ unit_id?: string; wet_or_dry?: string }>>('bpc_cart') || [];

                // Count how many of this unit are already in cart (same unit_id and wet_or_dry)
                const existingCount = cart.filter((item) =>
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
                  price_dry_cents: unit.price_dry_cents,
                  price_water_cents: unit.price_water_cents || unit.price_dry_cents,
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
          ? unit.media.filter((m) => m.mode === wetOrDry || m.visibility_mode === 'both')
          : unit.media;
        if (isWetDryUnitModal && wetOrDry === 'water' && filteredMedia.length === 0) {
          filteredMedia = unit.media.filter((m) => m.mode === 'dry');
        }
        const displayImage = filteredMedia[selectedImageIndex] || filteredMedia[0];

        return (
          <div
            className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
            onClick={() => setIsImageModalOpen(false)}
          >
            <div role="dialog" aria-modal="true" aria-label="Photos" className="relative max-w-7xl w-full h-full flex flex-col">
              <button
                type="button"
                aria-label="Close photos"
                onClick={() => setIsImageModalOpen(false)}
                className="absolute top-4 right-4 z-10 bg-white hover:bg-slate-100 text-slate-900 rounded-full p-3 min-h-[48px] min-w-[48px] shadow-lg transition-all"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <div
                className="flex-1 min-h-0 flex items-center justify-center"
                onClick={(e) => e.stopPropagation()}
                onTouchStart={(e) => {
                  const t = e.touches[0];
                  touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
                }}
                onTouchEnd={(e) => {
                  const t = e.changedTouches[0];
                  const start = touchStart.current;
                  touchStart.current = null;
                  if (!t || !start) return;
                  const dir = swipeDirection(start.x, start.y, t.clientX, t.clientY);
                  if (dir) setSelectedImageIndex((i) => stepIndex(i, dir, filteredMedia.length));
                }}
              >
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
                  {filteredMedia.map((media, idx) => (
                    <button
                      key={idx}
                      type="button"
                      aria-label={`Show photo ${idx + 1}`}
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
