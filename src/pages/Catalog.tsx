import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Users, Maximize, Zap, Droplets, Download } from 'lucide-react';
import { notifyError } from '../lib/notifications';

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
  quantity_available: number;
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

      setUnits(unitsWithMedia as any);
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

  const handleExportMenu = () => {
    if (units.length === 0) {
      notifyError('No units available to export');
      return;
    }

    const formatCurrency = (cents: number) => {
      return `$${(cents / 100).toFixed(2)}`;
    };

    const logoUrl = `${window.location.origin}/bounce party club logo.png`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Bounce Party Club - Rental Catalog</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: Arial, sans-serif;
              padding: 40px;
              background: white;
            }
            .header {
              text-align: center;
              margin-bottom: 40px;
              border-bottom: 4px solid;
              border-image: linear-gradient(90deg, #2563eb, #7c3aed, #db2777) 1;
              padding-bottom: 20px;
            }
            .header-logo {
              max-width: 200px;
              height: auto;
              margin-bottom: 15px;
            }
            .header h1 {
              font-size: 36px;
              color: #1e293b;
              margin-bottom: 10px;
            }
            .header p {
              font-size: 18px;
              color: #64748b;
            }
            .grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 30px;
              page-break-inside: avoid;
            }
            .unit-card {
              border: 3px solid transparent;
              background: linear-gradient(white, white) padding-box,
                          linear-gradient(135deg, #2563eb, #7c3aed, #db2777) border-box;
              border-radius: 12px;
              padding: 20px;
              page-break-inside: avoid;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .unit-image {
              width: 100%;
              height: 200px;
              object-fit: cover;
              border-radius: 8px;
              margin-bottom: 15px;
              border: 2px solid #e2e8f0;
            }
            .unit-card h2 {
              font-size: 24px;
              color: #1e293b;
              margin-bottom: 15px;
              border-bottom: 2px solid #2563eb;
              padding-bottom: 10px;
            }
            .unit-type {
              background: #dbeafe;
              color: #1e40af;
              padding: 6px 12px;
              border-radius: 6px;
              font-size: 14px;
              font-weight: bold;
              display: inline-block;
              margin-bottom: 15px;
            }
            .combo-badge {
              background: #fef3c7;
              color: #92400e;
              padding: 6px 12px;
              border-radius: 6px;
              font-size: 14px;
              font-weight: bold;
              display: inline-block;
              margin-left: 8px;
            }
            .details {
              margin: 15px 0;
            }
            .detail-row {
              display: flex;
              justify-content: space-between;
              padding: 8px 0;
              border-bottom: 1px solid #f1f5f9;
            }
            .detail-label {
              font-weight: bold;
              color: #64748b;
            }
            .detail-value {
              color: #1e293b;
            }
            .pricing {
              background: #f0fdf4;
              border: 2px solid #86efac;
              border-radius: 8px;
              padding: 15px;
              margin-top: 15px;
            }
            .pricing-row {
              display: flex;
              justify-content: space-between;
              margin: 8px 0;
            }
            .pricing-label {
              font-weight: bold;
              color: #166534;
            }
            .pricing-value {
              font-size: 20px;
              font-weight: bold;
              color: #15803d;
            }
            .footer {
              margin-top: 40px;
              text-align: center;
              padding-top: 20px;
              border-top: 2px solid #e2e8f0;
              color: #64748b;
              font-size: 14px;
            }
            @media print {
              body { padding: 20px; }
              .grid { gap: 20px; }
              .unit-card { page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <img src="${logoUrl}" alt="Bounce Party Club" class="header-logo" onerror="this.style.display='none'" />
            <h1>Bounce Party Club</h1>
            <p>Inflatable Rental Catalog - ${new Date().toLocaleDateString()}</p>
          </div>

          <div class="grid">
            ${units.map(unit => {
              const dryImages = (unit.media || []).filter((m: any) => m.mode === 'dry' || !m.mode);
              const imageUrl = dryImages.length > 0 ? dryImages[0].url : null;

              return `
              <div class="unit-card">
                ${imageUrl ? `<img src="${imageUrl}" alt="${unit.name}" class="unit-image" onerror="this.style.display='none'" />` : ''}
                <h2>${unit.name}</h2>
                <div>
                  <span class="unit-type">${unit.type}</span>
                  ${unit.is_combo ? '<span class="combo-badge">COMBO</span>' : ''}
                </div>

                <div class="details">
                  <div class="detail-row">
                    <span class="detail-label">Dimensions:</span>
                    <span class="detail-value">${unit.dimensions || 'N/A'}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Footprint:</span>
                    <span class="detail-value">${unit.footprint_sqft} sq ft</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Age Range:</span>
                    <span class="detail-value">All Ages</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Capacity:</span>
                    <span class="detail-value">${unit.capacity} kids at a time</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Quantity Available:</span>
                    <span class="detail-value">${unit.quantity_available}</span>
                  </div>
                </div>

                <div class="pricing">
                  <div class="pricing-row">
                    <span class="pricing-label">Dry Mode:</span>
                    <span class="pricing-value">${formatCurrency(unit.price_dry_cents)}</span>
                  </div>
                  ${unit.price_water_cents ? `
                    <div class="pricing-row">
                      <span class="pricing-label">Water Mode:</span>
                      <span class="pricing-value">${formatCurrency(unit.price_water_cents)}</span>
                    </div>
                  ` : ''}
                </div>
              </div>
            `;
            }).join('')}
          </div>

          <div class="footer">
            <p><strong>Bounce Party Club</strong> | Contact us for bookings and more information</p>
            <p style="margin-top: 8px;">Prices shown are base rental rates. Additional fees may apply for delivery, setup, and special requirements.</p>
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 500);
            };
          </script>
        </body>
      </html>
    `;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, '_blank');

    if (!printWindow) {
      notifyError('Unable to open print window. Please allow popups for this site.');
    }

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const eventDate = searchParams.get('date');
  const address = searchParams.get('address');

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
              <span className="hidden sm:inline">Export Menu</span>
            </button>
          </div>
          {eventDate && (
            <p className="text-base sm:text-lg text-slate-600">
              Showing availability for <span className="font-bold text-slate-900">{eventDate}</span>
              {address && (
                <>
                  {' '}
                  at <span className="font-bold text-slate-900">{address}</span>
                </>
              )}
            </p>
          )}
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
            Combo Units
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
                    {unit.is_combo && (
                      <span className="bg-gradient-to-r from-cyan-100 to-cyan-50 text-cyan-800 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-cyan-200">
                        COMBO
                      </span>
                    )}
                  </div>

                  <p className="text-slate-600 text-sm sm:text-base mb-5 font-medium">{unit.type}</p>

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
                    {unit.is_combo && (
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
            <a href="tel:+15551234567" className="text-blue-600 font-bold hover:underline">
              (555) 123-4567
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
