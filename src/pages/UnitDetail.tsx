import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { SafeStorage } from '../lib/safeStorage';
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
  type: string;
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
        .order('sort');

      if (mediaError) throw mediaError;

      setUnit({ ...unitData, media: (mediaData || []) as any } as any);
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
            <div className="aspect-video bg-slate-200 rounded-2xl overflow-hidden mb-4 shadow-xl border border-slate-200">
              {unit.media[0] ? (
                <img
                  src={unit.media[0].url}
                  alt={unit.media[0].alt}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400 font-medium">
                  No Image
                </div>
              )}
            </div>

            {unit.media.length > 1 && (
              <div className="grid grid-cols-4 gap-3">
                {unit.media.slice(1, 5).map((media, idx) => (
                  <div
                    key={idx}
                    className="aspect-video bg-slate-200 rounded-xl overflow-hidden shadow-md border border-slate-200 hover:shadow-lg transition-shadow"
                  >
                    <img
                      src={media.url}
                      alt={media.alt}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 mb-3 leading-tight tracking-tight">
                  {unit.name}
                </h1>
                <p className="text-lg sm:text-xl text-slate-600 font-medium">{unit.type}</p>
              </div>
              {unit.is_combo && (
                <span className="bg-gradient-to-r from-cyan-100 to-cyan-50 text-cyan-800 text-sm font-bold px-4 py-2 rounded-xl border-2 border-cyan-200 shadow-sm">
                  COMBO
                </span>
              )}
            </div>

            <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-2xl p-6 sm:p-7 mb-8 shadow-lg">
              <p className="text-xl sm:text-2xl text-blue-900 mb-3 font-bold flex items-center">
                <span className="mr-2">💰</span> Get Your Custom Quote
              </p>
              <p className="text-sm sm:text-base text-blue-800 mb-3 leading-relaxed">
                Pricing varies based on event date, location, setup preferences, and rental duration.
              </p>
              {unit.is_combo && (
                <p className="text-sm sm:text-base text-blue-800 flex items-center font-semibold">
                  <Droplets className="w-5 h-5 mr-2 flex-shrink-0" />
                  <span>This is a combo unit - choose wet or dry mode when requesting your quote</span>
                </p>
              )}
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

            {unit.is_combo && (
              <div className="mb-8">
                <label className="block text-base sm:text-lg font-bold text-slate-900 mb-4">
                  Select Mode
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setWetOrDry('dry')}
                    className={`flex flex-col items-center p-5 sm:p-6 rounded-2xl border-2 transition-all shadow-md hover:shadow-lg ${
                      wetOrDry === 'dry'
                        ? 'border-blue-600 bg-blue-50 shadow-lg'
                        : 'border-slate-300 hover:border-blue-400 bg-white'
                    }`}
                  >
                    <Sun className={`w-10 h-10 mb-3 ${
                      wetOrDry === 'dry' ? 'text-blue-600' : 'text-slate-400'
                    }`} />
                    <span className={`font-bold text-lg ${
                      wetOrDry === 'dry' ? 'text-blue-900' : 'text-slate-700'
                    }`}>
                      Dry
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWetOrDry('water')}
                    className={`flex flex-col items-center p-5 sm:p-6 rounded-2xl border-2 transition-all shadow-md hover:shadow-lg ${
                      wetOrDry === 'water'
                        ? 'border-blue-600 bg-blue-50 shadow-lg'
                        : 'border-slate-300 hover:border-blue-400 bg-white'
                    }`}
                  >
                    <Droplets className={`w-10 h-10 mb-3 ${
                      wetOrDry === 'water' ? 'text-blue-600' : 'text-slate-400'
                    }`} />
                    <span className={`font-bold text-lg ${
                      wetOrDry === 'water' ? 'text-blue-900' : 'text-slate-700'
                    }`}>
                      Water
                    </span>
                  </button>
                </div>
              </div>
            )}

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
                  is_combo: unit.is_combo,
                };
                cart.push(cartItem);
                SafeStorage.setItem('bpc_cart', cart, { expirationDays: 7 });
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
    </div>
  );
}
