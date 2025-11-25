import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Users, Maximize, Zap, Droplets } from 'lucide-react';

interface Unit {
  id: string;
  slug: string;
  name: string;
  type: string;
  is_combo: boolean | null;
  price_dry_cents: number;
  price_water_cents: number | null;
  dimensions: string;
  footprint_sqft: number;
  capacity: number;
  media: Array<{ url: string; alt: string }>;
}

export function Catalog() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');

  useEffect(() => {
    loadUnits();
    loadPrefillData();
  }, []);

  function loadPrefillData() {
    const prefillData = localStorage.getItem('bpc_quote_prefill');
    if (prefillData) {
      const data = JSON.parse(prefillData);
      console.log('Prefill data loaded:', data);
    }
  }

  async function loadUnits() {
    try {
      const { data: unitsData, error: unitsError } = await supabase
        .from('units')
        .select('*')
        .eq('active', true)
        .order('name');

      if (unitsError) throw unitsError;

      const { data: mediaData, error: mediaError } = await supabase
        .from('unit_media')
        .select('*')
        .order('sort');

      if (mediaError) throw mediaError;

      const unitsWithMedia = unitsData.map((unit) => ({
        ...unit,
        media: mediaData.filter((m) => m.unit_id === unit.id),
      }));

      setUnits(unitsWithMedia);
    } catch (error) {
      console.error('Error loading units:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredUnits = units.filter((unit) => {
    if (filterType === 'all') return true;
    if (filterType === 'combo') return unit.is_combo;
    if (filterType === 'bounce') return unit.type === 'Bounce House';
    if (filterType === 'slide') return unit.type.includes('Slide');
    if (filterType === 'obstacle') return unit.type === 'Obstacle Course';
    return true;
  });

  const eventDate = searchParams.get('date');
  const address = searchParams.get('address');

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-slate-600">Loading units...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-slate-900 mb-4">Browse Our Inflatables</h1>
        {eventDate && (
          <p className="text-slate-600">
            Showing availability for <span className="font-semibold">{eventDate}</span>
            {address && (
              <>
                {' '}
                at <span className="font-semibold">{address}</span>
              </>
            )}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-8">
        <button
          onClick={() => setFilterType('all')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            filterType === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-600'
          }`}
        >
          All Inflatables
        </button>
        <button
          onClick={() => setFilterType('bounce')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            filterType === 'bounce'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-600'
          }`}
        >
          Bounce Houses
        </button>
        <button
          onClick={() => setFilterType('combo')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            filterType === 'combo'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-600'
          }`}
        >
          Combo Units
        </button>
        <button
          onClick={() => setFilterType('slide')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            filterType === 'slide'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-600'
          }`}
        >
          Water Slides
        </button>
        <button
          onClick={() => setFilterType('obstacle')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            filterType === 'obstacle'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-600'
          }`}
        >
          Obstacle Courses
        </button>
      </div>

      {filteredUnits.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-slate-600 text-lg">No inflatables found matching your criteria.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredUnits.map((unit) => (
            <Link
              key={unit.id}
              to={`/units/${unit.slug}`}
              className="bg-white rounded-xl shadow-md hover:shadow-xl transition-shadow overflow-hidden group"
            >
              <div className="aspect-video bg-slate-200 overflow-hidden">
                {unit.media[0] ? (
                  <img
                    src={unit.media[0].url}
                    alt={unit.media[0].alt}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400">
                    No Image
                  </div>
                )}
              </div>

              <div className="p-6">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-xl font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                    {unit.name}
                  </h3>
                  {unit.is_combo && (
                    <span className="bg-cyan-100 text-cyan-800 text-xs font-semibold px-2 py-1 rounded">
                      COMBO
                    </span>
                  )}
                </div>

                <p className="text-slate-600 text-sm mb-4">{unit.type}</p>

                <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                  <div className="flex items-center text-slate-600">
                    <Users className="w-4 h-4 mr-1" />
                    <span>{unit.capacity} kids</span>
                  </div>
                  <div className="flex items-center text-slate-600">
                    <Maximize className="w-4 h-4 mr-1" />
                    <span>{unit.dimensions}</span>
                  </div>
                  <div className="flex items-center text-slate-600">
                    <Zap className="w-4 h-4 mr-1" />
                    <span>{unit.footprint_sqft} sq ft</span>
                  </div>
                  {unit.is_combo && (
                    <div className="flex items-center text-slate-600">
                      <Droplets className="w-4 h-4 mr-1" />
                      <span>Wet/Dry</span>
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-200 pt-4">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/units/${unit.slug}`);
                    }}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    View Details
                  </button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-12 bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-2">
          Need help choosing?
        </h3>
        <p className="text-slate-600 mb-4">
          Our team can help you find the perfect unit for your event. Call us at{' '}
          <a href="tel:+15551234567" className="text-blue-600 font-semibold hover:underline">
            (555) 123-4567
          </a>{' '}
          or get a custom quote.
        </p>
        <Link
          to="/quote"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
        >
          Get a Quote
        </Link>
      </div>
    </div>
  );
}
