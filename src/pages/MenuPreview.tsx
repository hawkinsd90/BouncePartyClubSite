import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { notifyError } from '../lib/notifications';

type Unit = {
  id: string;
  name: string;
  type: string;
  is_combo: boolean | null;
  price_dry_cents: number;
  price_water_cents: number | null;
  dimensions: string;
  footprint_sqft: number;
  capacity: number;
  quantity_available: number;
  media: Array<{ url: string; alt: string; mode?: string | null }>;
};

type MenuPreviewData = {
  generatedAtIso: string;
  units: Unit[];
  title?: string;
};

function formatCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function preloadImages(urls: string[]) {
  const unique = Array.from(new Set(urls.filter(Boolean)));
  return Promise.all(
    unique.map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = src;
        })
    )
  );
}

export function MenuPreview() {
  const navigate = useNavigate();
  const [data, setData] = useState<MenuPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const returnTo = useMemo(() => {
    return sessionStorage.getItem('menu-preview-return-to') || '';
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('menu-preview-data');
      if (!raw) {
        setError('No menu data found. Please go back and try again.');
        return;
      }
      const parsed = JSON.parse(raw) as MenuPreviewData;

      if (!parsed?.units || !Array.isArray(parsed.units) || parsed.units.length === 0) {
        setError('Menu data is incomplete. Please go back and try again.');
        return;
      }

      setData(parsed);
    } catch (e) {
      console.error('MenuPreview parse error', e);
      setError('Failed to load menu preview data.');
    }
  }, []);

  useEffect(() => {
    return () => {
      sessionStorage.removeItem('menu-preview-data');
      sessionStorage.removeItem('menu-preview-return-to');
    };
  }, []);

  const handleBack = () => {
    if (returnTo) {
      navigate(returnTo);
      return;
    }
    navigate(-1);
  };

  const handlePrint = async () => {
    if (!data) return;

    const logoUrl = `${window.location.origin}/bounce party club logo.png`;

    const unitImageUrls = data.units
      .map((u) => {
        const dryImages = (u.media || []).filter((m: any) => m.mode === 'dry' || !m.mode);
        return dryImages[0]?.url || u.media?.[0]?.url || '';
      })
      .filter(Boolean);

    try {
      document.body.classList.add('print-menu-preview');
      await preloadImages([logoUrl, ...unitImageUrls]);

      // Let layout settle before opening print dialog
      setTimeout(() => window.print(), 50);
    } catch (e) {
      console.error(e);
      notifyError('Could not prepare print preview.');
      document.body.classList.remove('print-menu-preview');
    } finally {
      // Cleanup after dialog opens
      setTimeout(() => document.body.classList.remove('print-menu-preview'), 750);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md text-center bg-white rounded-xl shadow p-8">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Unable to Load Menu</h2>
          <p className="text-slate-600 mb-6">{error}</p>
          <button
            onClick={handleBack}
            className="inline-flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-slate-600">Loading menu...</p>
        </div>
      </div>
    );
  }

  const generatedDate = new Date(data.generatedAtIso);

  return (
    <div id="menu-print-wrapper" className="menu-preview-route min-h-screen bg-slate-50 py-8 px-4">
      {/* Top action bar (screen only) */}
      <div className="max-w-5xl mx-auto mb-4 flex items-center justify-between gap-3 no-print">
        <button
          onClick={handleBack}
          className="inline-flex items-center bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-2 px-4 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </button>

        <button
          onClick={handlePrint}
          className="inline-flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
        >
          <Printer className="w-4 h-4 mr-2" />
          Print / Save PDF
        </button>
      </div>

      {/* PRINT HEADER */}
      <div className="menu-print-header">
        <img
          src="/bounce party club logo.png"
          alt="Bounce Party Club"
          className="menu-print-logo"
          onError={(e) => ((e.currentTarget.style.display = 'none'))}
        />

        <div className="menu-print-header-center">
          <div className="menu-print-title">{data.title || 'Inflatable Price List'}</div>
          <div className="menu-print-subtitle">
            Generated {generatedDate.toLocaleDateString('en-US')}
          </div>
        </div>

        {/* spacer so centered text stays centered in print */}
        <div className="menu-print-header-right" aria-hidden="true" />
      </div>

      {/* Page number (PRINT ONLY via CSS positioning) */}
      <div className="menu-print-page-number" aria-hidden="true" />

      {/* Content */}
      <div className="menu-print-content max-w-5xl mx-auto">
        <div className="menu-print-grid">
          {data.units.map((unit) => {
            const dryImages = (unit.media || []).filter((m: any) => m.mode === 'dry' || !m.mode);
            const imageUrl = dryImages[0]?.url || unit.media?.[0]?.url || '';

            return (
              <div key={unit.id} className="menu-unit-card">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={unit.name}
                    className="menu-unit-image"
                    onError={(e) => ((e.currentTarget.style.display = 'none'))}
                  />
                ) : null}

                <div className="menu-unit-name-row">
                  <div className="menu-unit-name">{unit.name}</div>
                  {unit.is_combo ? <div className="menu-unit-badge">COMBO</div> : null}
                </div>

                <div className="menu-unit-type">{unit.type}</div>

                <div className="menu-unit-details">
                  <div className="menu-detail-row">
                    <span className="menu-detail-label">Dimensions</span>
                    <span className="menu-detail-value">{unit.dimensions || 'N/A'}</span>
                  </div>
                  <div className="menu-detail-row">
                    <span className="menu-detail-label">Footprint</span>
                    <span className="menu-detail-value">{unit.footprint_sqft} sq ft</span>
                  </div>
                  <div className="menu-detail-row">
                    <span className="menu-detail-label">Capacity</span>
                    <span className="menu-detail-value">{unit.capacity} kids</span>
                  </div>
                  <div className="menu-detail-row">
                    <span className="menu-detail-label">Qty Available</span>
                    <span className="menu-detail-value">{unit.quantity_available}</span>
                  </div>
                </div>

                <div className="menu-unit-pricing">
                  <div className="menu-price-row">
                    <span className="menu-price-label">Dry</span>
                    <span className="menu-price-value">{formatCurrency(unit.price_dry_cents)}</span>
                  </div>
                  {unit.price_water_cents ? (
                    <div className="menu-price-row">
                      <span className="menu-price-label">Water</span>
                      <span className="menu-price-value">{formatCurrency(unit.price_water_cents)}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="menu-print-footer">
          <div>
            <strong>Bounce Party Club</strong> • Prices shown are base rental rates. Delivery/setup
            fees may apply.
          </div>
          <div className="menu-print-footer-muted">
            Prices are subject to change. Please confirm final pricing at booking.
          </div>
        </div>
      </div>
    </div>
  );
}
