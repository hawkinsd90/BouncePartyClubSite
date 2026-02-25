import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { SafeStorage } from '../lib/safeStorage';
import { Users, Maximize, Zap, Droplets, Download } from 'lucide-react';
import { notifyError } from '../lib/notifications';
import { DatePickerInput } from '../components/ui/DatePickerInput';

interface Unit {
  id: string;
  slug: string;
  name: string;
  types: string[];
  type?: string;
  is_combo: boolean | null;
  price_dry_cents: number;
  price_water_cents: number | null;
  dimensions: string;
  footprint_sqft: number;
  capacity: number;
  quantity_available: number;
  media: Array<{ url: string; alt: string }>;
}

export function Catalog() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [eventDate, setEventDate] = useState<string>('');

  useEffect(() => {
    let mounted = true;

    loadPrefillData();

    async function loadUnitsAsync() {
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
          .order('is_featured', { ascending: false })
          .order('sort');

        if (mediaError) throw mediaError;

        const unitsWithMedia = unitsData.map((unit) => ({
          ...unit,
          media: mediaData.filter((m) => m.unit_id === unit.id),
        }));

        // Only update state if component is still mounted
        if (mounted) {
          setUnits(unitsWithMedia as any);
        }
      } catch (error) {
        console.error('Error loading units:', error);
        // Don't throw error - just show empty state
        if (mounted) {
          notifyError('Failed to load units. Please refresh the page.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadUnitsAsync();

    // Handle page visibility changes (when user returns to the app)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && mounted && units.length > 0) {
        console.log('Page became visible, data is already loaded');
        // Data is already loaded, no need to reload
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup function to prevent state updates after unmount
    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  function loadPrefillData() {
    // Check for prefill data from home page
    const prefillData = SafeStorage.getItem<any>('bpc_quote_prefill');
    if (prefillData && prefillData.event_date) {
      console.log('Prefill data loaded:', prefillData);
      setEventDate(prefillData.event_date);
      return;
    }

    // Check for saved form data from quote page (when coming back from cart)
    const formData = SafeStorage.getItem<any>('bpc_quote_form');
    if (formData && formData.event_date) {
      console.log('Form data loaded:', formData);
      setEventDate(formData.event_date);
    }
  }

  const filteredUnits = units.filter((unit) => {
    if (filterType === 'all') return true;
    const unitTypes = unit.types || (unit.type ? [unit.type] : []);
    if (filterType === 'combo') return unitTypes.includes('Combo');
    if (filterType === 'bounce') return unitTypes.includes('Bounce House');
    if (filterType === 'slide') return unitTypes.some(t => t.includes('Slide'));
    if (filterType === 'obstacle') return unitTypes.includes('Obstacle Course');
    return true;
  });

  const handleExportMenu = () => {
    if (units.length === 0) {
      notifyError('No units available to export');
      return;
    }

    const menuData = {
      generatedAtIso: new Date().toISOString(),
      title: 'Bounce Party Club Menu',
      units: filteredUnits, // respects current filter buttons
    };

    sessionStorage.setItem('menu-preview-data', JSON.stringify(menuData));

    const returnTo = window.location.pathname + window.location.search + window.location.hash;
    sessionStorage.setItem('menu-preview-return-to', returnTo);

    navigate('/menu-preview');
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-slate-600 font-medium">Loading units...</p>
        </div>
      </div>
    );
  }

  const handleDateChange = (newDate: string) => {
    setEventDate(newDate);

    // Update the prefill data if it exists
    const prefillData = SafeStorage.getItem<any>('bpc_quote_prefill');
    if (prefillData) {
      SafeStorage.setItem('bpc_quote_prefill', { ...prefillData, event_date: newDate }, { expirationDays: 7 });
    }

    // Update the form data if it exists
    const formData = SafeStorage.getItem<any>('bpc_quote_form');
    if (formData) {
      SafeStorage.setItem('bpc_quote_form', { ...formData, event_date: newDate, event_end_date: newDate }, { expirationDays: 7 });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="mb-10 sm:mb-12">
          <div className="flex items-center justify-between mb-4 sm:mb-5">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 tracking-tight">
              Browse Our Inflatables
            </h1>
            <button
              onClick={handleExportMenu}
              className="flex items-center gap-2 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl"
            >
              <Download className="w-5 h-5" />
              <span className="hidden sm:inline">Download Menu PDF</span>
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-md p-4 sm:p-6 border-2 border-blue-200 mb-6">
            <div className="mb-3">
              <label className="block text-sm sm:text-base font-semibold text-slate-700 mb-1">
                Event Date
              </label>
              {eventDate && (
                <p className="text-xs sm:text-sm text-blue-600 font-medium">
                  Filtering available units for this date
                </p>
              )}
            </div>
            <div className="max-w-sm">
              <DatePickerInput
                value={eventDate}
                onChange={handleDateChange}
                min={new Date().toISOString().split('T')[0]}
                placeholder="Select event date"
                showIcon={true}
              />
            </div>
            {eventDate && (
              <p className="text-xs sm:text-sm text-slate-600 mt-2 break-words">
                Showing inflatables available on <span className="font-bold text-slate-900">{new Date(eventDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 sm:gap-4 mb-10 sm:mb-12">
          <button
            onClick={() => setFilterType('all')}
            className={`px-5 py-3 rounded-xl font-bold transition-all shadow-sm hover:shadow-md text-sm sm:text-base ${
              filterType === 'all'
                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg'
                : 'bg-white text-slate-700 border-2 border-slate-300 hover:border-blue-600'
            }`}
          >
            All Inflatables
          </button>
          <button
            onClick={() => setFilterType('bounce')}
            className={`px-5 py-3 rounded-xl font-bold transition-all shadow-sm hover:shadow-md text-sm sm:text-base ${
              filterType === 'bounce'
                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg'
                : 'bg-white text-slate-700 border-2 border-slate-300 hover:border-blue-600'
            }`}
          >
            Bounce Houses
          </button>
          <button
            onClick={() => setFilterType('combo')}
            className={`px-5 py-3 rounded-xl font-bold transition-all shadow-sm hover:shadow-md text-sm sm:text-base ${
              filterType === 'combo'
                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg'
                : 'bg-white text-slate-700 border-2 border-slate-300 hover:border-blue-600'
            }`}
          >
            Wet or Dry Units
          </button>
          <button
            onClick={() => setFilterType('slide')}
            className={`px-5 py-3 rounded-xl font-bold transition-all shadow-sm hover:shadow-md text-sm sm:text-base ${
              filterType === 'slide'
                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg'
                : 'bg-white text-slate-700 border-2 border-slate-300 hover:border-blue-600'
            }`}
          >
            Water Slides
          </button>
          <button
            onClick={() => setFilterType('obstacle')}
            className={`px-5 py-3 rounded-xl font-bold transition-all shadow-sm hover:shadow-md text-sm sm:text-base ${
              filterType === 'obstacle'
                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg'
                : 'bg-white text-slate-700 border-2 border-slate-300 hover:border-blue-600'
            }`}
          >
            Obstacle Courses
          </button>
        </div>

        {filteredUnits.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-slate-600 text-lg sm:text-xl font-medium">
              No inflatables found matching your criteria.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {filteredUnits.map((unit) => (
              <Link
                key={unit.id}
                to={`/units/${unit.slug}`}
                className="bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden group border border-slate-200"
              >
                <div className="aspect-video bg-slate-200 overflow-hidden">
                  {unit.media[0] ? (
                    <img
                      src={unit.media[0].url}
                      alt={unit.media[0].alt}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 font-medium">
                      No Image
                    </div>
                  )}
                </div>

                <div className="p-6">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-xl sm:text-2xl font-bold text-slate-900 group-hover:text-blue-600 transition-colors leading-tight">
                      {unit.name}
                    </h3>
                    {((unit.types || []).includes('Combo') || (unit.types || []).includes('Water Slide')) && (
                      <span className="bg-gradient-to-r from-cyan-100 to-cyan-50 text-cyan-800 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-cyan-200">
                        WET/DRY
                      </span>
                    )}
                  </div>

                  <p className="text-slate-600 text-sm sm:text-base mb-5 font-medium">
                    {(unit.types || (unit.type ? [unit.type] : [])).join(' • ')}
                  </p>

                  <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-5 text-sm">
                    <div className="flex items-center text-slate-700">
                      <Users className="w-4 h-4 mr-2 text-blue-600" />
                      <span className="font-semibold">{unit.capacity} kids</span>
                    </div>
                    <div className="flex items-center text-slate-700">
                      <Maximize className="w-4 h-4 mr-2 text-blue-600" />
                      <span className="font-semibold">{unit.dimensions}</span>
                    </div>
                    <div className="flex items-center text-slate-700">
                      <Zap className="w-4 h-4 mr-2 text-blue-600" />
                      <span className="font-semibold">{unit.footprint_sqft} sq ft</span>
                    </div>
                    {((unit.types || []).includes('Combo') || (unit.types || []).includes('Water Slide')) && (
                      <div className="flex items-center text-slate-700">
                        <Droplets className="w-4 h-4 mr-2 text-blue-600" />
                        <span className="font-semibold">Wet/Dry</span>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-200 pt-5">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        navigate(`/units/${unit.slug}`);
                      }}
                      className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-3 px-4 rounded-xl transition-all shadow-md hover:shadow-lg"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-16 sm:mt-20 bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-2xl p-8 sm:p-10 shadow-lg">
          <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">
            Need help choosing?
          </h3>
          <p className="text-slate-700 mb-6 text-base sm:text-lg leading-relaxed">
            Our team can help you find the perfect unit for your event. Call us at{' '}
            <a href="tel:+13138893860" className="text-blue-600 font-bold hover:underline">
              (313) 889-3860
            </a>{' '}
            or get a custom quote.
          </p>
          <Link
            to="/quote"
            className="inline-block bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-3 px-8 rounded-xl transition-all shadow-lg hover:shadow-xl"
          >
            Get a Quote
          </Link>
        </div>
      </div>
    </div>
  );
}
