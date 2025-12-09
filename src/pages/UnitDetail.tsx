import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
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
          <p className="mt-4 text-slate-600">Loading unit details...</p>
        </div>
      </div>
    );
  }

  if (!unit) {
    return null;
  }


  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <button
        onClick={() => navigate('/catalog')}
        className="flex items-center text-slate-600 hover:text-blue-600 mb-6 transition-colors"
      >
        <ArrowLeft className="w-5 h-5 mr-2" />
        Back to Catalog
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        <div>
          <div className="aspect-video bg-slate-200 rounded-xl overflow-hidden mb-4">
            {unit.media[0] ? (
              <img
                src={unit.media[0].url}
                alt={unit.media[0].alt}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-400">
                No Image
              </div>
            )}
          </div>

          {unit.media.length > 1 && (
            <div className="grid grid-cols-4 gap-2">
              {unit.media.slice(1, 5).map((media, idx) => (
                <div
                  key={idx}
                  className="aspect-video bg-slate-200 rounded-lg overflow-hidden"
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
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold text-slate-900 mb-2">{unit.name}</h1>
              <p className="text-lg text-slate-600">{unit.type}</p>
            </div>
            {unit.is_combo && (
              <span className="bg-cyan-100 text-cyan-800 text-sm font-semibold px-3 py-1 rounded">
                COMBO
              </span>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
            <p className="text-lg text-blue-900 mb-2 font-semibold">
              💰 Get Your Custom Quote
            </p>
            <p className="text-sm text-blue-800 mb-3">
              Pricing varies based on event date, location, setup preferences, and rental duration.
            </p>
            {unit.is_combo && (
              <p className="text-sm text-blue-800 flex items-center">
                <Droplets className="w-4 h-4 mr-2" />
                <span className="font-medium">This is a combo unit - choose wet or dry mode when requesting your quote</span>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-center text-slate-600 mb-1">
                <Users className="w-5 h-5 mr-2" />
                <span className="text-sm font-medium">Capacity</span>
              </div>
              <div className="text-xl font-bold text-slate-900">{unit.capacity} kids</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-center text-slate-600 mb-1">
                <Maximize className="w-5 h-5 mr-2" />
                <span className="text-sm font-medium">Dimensions</span>
              </div>
              <div className="text-xl font-bold text-slate-900">{unit.dimensions}</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-center text-slate-600 mb-1">
                <Zap className="w-5 h-5 mr-2" />
                <span className="text-sm font-medium">Space Needed</span>
              </div>
              <div className="text-xl font-bold text-slate-900">
                {unit.footprint_sqft} sq ft
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-center text-slate-600 mb-1">
                <Zap className="w-5 h-5 mr-2" />
                <span className="text-sm font-medium">Power</span>
              </div>
              <div className="text-xl font-bold text-slate-900">
                {unit.power_circuits} outlet{unit.power_circuits > 1 ? 's' : ''}
              </div>
            </div>
          </div>

          <div className="bg-slate-50 rounded-lg p-4 mb-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center">
                <Home className="w-5 h-5 mr-2 text-slate-600" />
                <span className="text-slate-700">
                  Indoor: {unit.indoor_ok ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex items-center">
                <Sun className="w-5 h-5 mr-2 text-slate-600" />
                <span className="text-slate-700">
                  Outdoor: {unit.outdoor_ok ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
          </div>

          {unit.is_combo && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-3">
                Select Mode
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setWetOrDry('dry')}
                  className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all ${
                    wetOrDry === 'dry'
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-slate-300 hover:border-blue-400'
                  }`}
                >
                  <Sun className={`w-8 h-8 mb-2 ${
                    wetOrDry === 'dry' ? 'text-blue-600' : 'text-slate-400'
                  }`} />
                  <span className={`font-semibold ${
                    wetOrDry === 'dry' ? 'text-blue-900' : 'text-slate-700'
                  }`}>
                    Dry
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setWetOrDry('water')}
                  className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all ${
                    wetOrDry === 'water'
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-slate-300 hover:border-blue-400'
                  }`}
                >
                  <Droplets className={`w-8 h-8 mb-2 ${
                    wetOrDry === 'water' ? 'text-blue-600' : 'text-slate-400'
                  }`} />
                  <span className={`font-semibold ${
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
              const cart = JSON.parse(localStorage.getItem('bpc_cart') || '[]');

              // Count how many of this unit are already in cart (same unit_id and wet_or_dry)
              const existingCount = cart.filter((item: any) =>
                item.unit_id === unit.id && item.wet_or_dry === wetOrDry
              ).length;

              // Check if we can add more
              if (existingCount >= unit.quantity_available) {
                alert(`Sorry, we only have ${unit.quantity_available} of this item available. You already have ${existingCount} in your cart.`);
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
              localStorage.setItem('bpc_cart', JSON.stringify(cart));
              navigate('/quote');
            }}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-6 rounded-lg transition-colors flex items-center justify-center text-lg"
          >
            <ShoppingCart className="w-6 h-6 mr-2" />
            Add to Cart
          </button>

          <div className="mt-6 border-t border-slate-200 pt-6">
            <h3 className="font-semibold text-slate-900 mb-3">What's Included:</h3>
            <ul className="space-y-2 text-slate-600">
              <li className="flex items-start">
                <span className="text-green-600 mr-2">✓</span>
                <span>Delivery, setup, and pickup</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-600 mr-2">✓</span>
                <span>Professional installation by trained crew</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-600 mr-2">✓</span>
                <span>Safety stakes or sandbags (surface dependent)</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-600 mr-2">✓</span>
                <span>Blower and extension cord</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-600 mr-2">✓</span>
                <span>Safety inspection and equipment cleaning</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
