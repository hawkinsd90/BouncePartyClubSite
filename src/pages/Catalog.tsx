import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { SafeStorage } from '../lib/safeStorage';
import { Users, Maximize, Zap, Droplets, Download, Search, XCircle, CheckCircle, Tag } from 'lucide-react';
import { notifyError } from '../lib/notifications';
import { DatePickerInput } from '../components/ui/DatePickerInput';
import { checkUnitAvailability } from '../lib/availability';
import { trackEventOnce } from '../lib/siteEvents';

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
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [eventDate, setEventDate] = useState<string>('');
  const [availabilityChecked, setAvailabilityChecked] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [unavailableUnitIds, setUnavailableUnitIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;

    loadPrefillData();

    async function loadUnitsAsync() {
      try {
        const { data: unitsData, error: unitsError } = await supabase
          .from('units')
          .select(`
            *,
            unit_media (
              id,
              url,
              alt,
              sort,
              is_featured
            )
          `)
          .eq('active', true)
          .order('name');

        if (unitsError) throw unitsError;

        const unitsWithMedia = unitsData.map((unit: any) => ({
          ...unit,
          media: (unit.unit_media || []).sort((a: any, b: any) => {
            if (a.is_featured !== b.is_featured) {
              return b.is_featured ? 1 : -1;
            }
            return (a.sort || 0) - (b.sort || 0);
          }),
        }));

        if (mounted) {
          setUnits(unitsWithMedia as any);
        }
      } catch (error) {
        console.error('Error loading units:', error);
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && mounted && units.length > 0) {
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  function loadPrefillData() {
    const prefillData = SafeStorage.getItem<any>('bpc_quote_prefill');
    if (prefillData && prefillData.event_date) {
      setEventDate(prefillData.event_date);
      return;
    }

    const formData = SafeStorage.getItem<any>('bpc_quote_form');
    if (formData && formData.event_date) {
      setEventDate(formData.event_date);
    }
  }

  const handleCheckAvailability = useCallback(async () => {
    if (!eventDate || units.length === 0) return;

    setAvailabilityLoading(true);
    setAvailabilityChecked(false);

    try {
      const results = await Promise.all(
        units.map(unit =>
          checkUnitAvailability({
            unitId: unit.id,
            eventStartDate: eventDate,
            eventEndDate: eventDate,
          })
        )
      );

      const unavailable = new Set<string>();
      results.forEach(result => {
        if (!result.isAvailable) {
          unavailable.add(result.unitId);
        }
      });

      setUnavailableUnitIds(unavailable);
      setAvailabilityChecked(true);
    } catch {
      notifyError('Failed to check availability. Please try again.');
    } finally {
      setAvailabilityLoading(false);
    }
  }, [eventDate, units]);

  const handleClearAvailability = () => {
    setAvailabilityChecked(false);
    setUnavailableUnitIds(new Set());
  };

  const categoryFilteredUnits = units.filter((unit) => {
    if (filterType === 'all') return true;
    const unitTypes = unit.types || (unit.type ? [unit.type] : []);
    if (filterType === 'combo') return unitTypes.includes('Combo');
    if (filterType === 'bounce') return unitTypes.includes('Bounce House');
    if (filterType === 'slide') return unitTypes.some(t => t.includes('Slide'));
    if (filterType === 'obstacle') return unitTypes.includes('Obstacle Course');
    return true;
  });

  const filteredUnits = availabilityChecked
    ? categoryFilteredUnits.filter(unit => !unavailableUnitIds.has(unit.id))
    : categoryFilteredUnits;

  const unavailableInCategory = availabilityChecked
    ? categoryFilteredUnits.filter(unit => unavailableUnitIds.has(unit.id))
    : [];

  const handleExportMenu = () => {
    if (units.length === 0) {
      notifyError('No units available to export');
      return;
    }

    const menuData = {
      generatedAtIso: new Date().toISOString(),
      title: 'Bounce Party Club Menu',
      units: filteredUnits,
    };

    sessionStorage.setItem('menu-preview-data', JSON.stringify(menuData));

    const returnTo = window.location.pathname + window.location.search + window.location.hash;
    sessionStorage.setItem('menu-preview-return-to', returnTo);

    navigate('/menu-preview');
  };

  useEffect(() => {
    if (!loading && units.length > 0) {
      trackEventOnce('price_preview_shown', { metadata: { context: 'catalog' } });
    }
  }, [loading, units.length]);

  function getStartingPriceCents(unit: Unit): number {
    if (unit.price_water_cents && unit.price_water_cents > 0) {
      return Math.min(unit.price_dry_cents, unit.price_water_cents);
    }
    return unit.price_dry_cents;
  }

  function formatDollars(cents: number): string {
    return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

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
    setAvailabilityChecked(false);
    setUnavailableUnitIds(new Set());

    const prefillData = SafeStorage.getItem<any>('bpc_quote_prefill');
    if (prefillData) {
      SafeStorage.setItem('bpc_quote_prefill', { ...prefillData, event_date: newDate }, { expirationDays: 7 });
    }

    const formData = SafeStorage.getItem<any>('bpc_quote_form');
    if (formData) {
      SafeStorage.setItem('bpc_quote_form', { ...formData, event_date: newDate, event_end_date: newDate }, { expirationDays: 7 });
    }
  };

  const formattedDate = eventDate
    ? new Date(eventDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="mb-10 sm:mb-12">
          <div className="flex items-start justify-between gap-4 mb-4 sm:mb-5">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 tracking-tight">
              Browse Our Inflatables
            </h1>
            <button
              onClick={handleExportMenu}
              className="flex-shrink-0 flex items-center gap-2 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-bold py-3 px-4 sm:px-6 rounded-xl transition-all shadow-lg hover:shadow-xl text-sm sm:text-base"
            >
              <Download className="w-5 h-5 flex-shrink-0" />
              <span className="sm:hidden">Menu PDF</span>
              <span className="hidden sm:inline">Download Menu PDF</span>
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-md p-4 sm:p-6 border-2 border-blue-200 mb-6">
            <label className="block text-sm sm:text-base font-semibold text-slate-700 mb-3">
              Check Availability for a Date
            </label>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
              <div className="w-full sm:max-w-xs">
                <DatePickerInput
                  value={eventDate}
                  onChange={handleDateChange}
                  min={new Date().toISOString().split('T')[0]}
                  placeholder="Select event date"
                  showIcon={true}
                />
              </div>
              {eventDate && (
                <button
                  onClick={handleCheckAvailability}
                  disabled={availabilityLoading}
                  className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:opacity-60 text-white font-bold py-3 px-5 rounded-xl transition-all shadow-md hover:shadow-lg whitespace-nowrap"
                >
                  {availabilityLoading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  {availabilityLoading ? 'Checking...' : 'Check Availability'}
                </button>
              )}
              {availabilityChecked && (
                <button
                  onClick={handleClearAvailability}
                  className="flex items-center gap-2 text-slate-600 hover:text-slate-800 font-semibold py-3 px-3 rounded-xl transition-all border-2 border-slate-300 hover:border-slate-400 bg-white whitespace-nowrap"
                >
                  <XCircle className="w-4 h-4" />
                  Show All
                </button>
              )}
            </div>

            {availabilityChecked && (
              <div className="mt-3 flex flex-wrap gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                  <CheckCircle className="w-4 h-4" />
                  {filteredUnits.length} available on {formattedDate}
                </div>
                {unavailableInCategory.length > 0 && (
                  <div className="flex items-center gap-2 text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                    <XCircle className="w-4 h-4" />
                    {unavailableInCategory.length} already booked — hidden
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 sm:gap-4 mb-10 sm:mb-12">
          {(['all', 'bounce', 'combo', 'slide', 'obstacle'] as const).map((type) => {
            const labels: Record<string, string> = {
              all: 'All Inflatables',
              bounce: 'Bounce Houses',
              combo: 'Wet or Dry Units',
              slide: 'Water Slides',
              obstacle: 'Obstacle Courses',
            };
            return (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-5 py-3 rounded-xl font-bold transition-all shadow-sm hover:shadow-md text-sm sm:text-base ${
                  filterType === type
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg'
                    : 'bg-white text-slate-700 border-2 border-slate-300 hover:border-blue-600'
                }`}
              >
                {labels[type]}
              </button>
            );
          })}
        </div>

        {filteredUnits.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-slate-600 text-lg sm:text-xl font-medium">
              {availabilityChecked
                ? `No inflatables are available on ${formattedDate} in this category.`
                : 'No inflatables found matching your criteria.'}
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
                      loading="lazy"
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
                    {(unit.types || []).includes('Combo') && (
                      <span className="bg-gradient-to-r from-cyan-100 to-cyan-50 text-cyan-800 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-cyan-200">
                        WET/DRY
                      </span>
                    )}
                    {(unit.types || []).includes('Water Slide') && !(unit.types || []).includes('Combo') && (
                      <span className="bg-gradient-to-r from-blue-100 to-blue-50 text-blue-800 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-blue-200">
                        WET
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
                    {(unit.types || []).includes('Combo') && (
                      <div className="flex items-center text-slate-700">
                        <Droplets className="w-4 h-4 mr-2 text-blue-600" />
                        <span className="font-semibold">Wet/Dry</span>
                      </div>
                    )}
                    {(unit.types || []).includes('Water Slide') && !(unit.types || []).includes('Combo') && (
                      <div className="flex items-center text-slate-700">
                        <Droplets className="w-4 h-4 mr-2 text-blue-600" />
                        <span className="font-semibold">Wet Only</span>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-200 pt-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-1.5 text-green-700">
                        <Tag className="w-4 h-4 flex-shrink-0" />
                        <span className="text-sm font-semibold">
                          Starting at{' '}
                          <span className="text-base font-bold text-green-800">
                            {formatDollars(getStartingPriceCents(unit))}
                          </span>
                        </span>
                      </div>
                    </div>
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
