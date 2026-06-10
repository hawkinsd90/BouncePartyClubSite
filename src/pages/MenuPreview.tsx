import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, Download } from 'lucide-react';
import { toPng } from 'html-to-image';
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

function getUnitImageUrl(unit: Unit): string {
  const allImages = unit.media || [];
  const featured = allImages.find((m: any) => m.is_featured);
  const dryImages = allImages.filter((m: any) => m.mode === 'dry' || !m.mode);
  return featured?.url || dryImages[0]?.url || allImages[0]?.url || '';
}

function getUnitImageUrls(units: Unit[]): string[] {
  return units.map(getUnitImageUrl).filter(Boolean);
}

export function MenuPreview() {
  const navigate = useNavigate();
  const [data, setData] = useState<MenuPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingImage, setSavingImage] = useState(false);

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

    try {
      document.body.classList.add('print-menu-preview');
      await preloadImages([logoUrl, ...getUnitImageUrls(data.units)]);

      setTimeout(() => window.print(), 50);
    } catch (e) {
      console.error(e);
      notifyError('Could not prepare print preview.');
      document.body.classList.remove('print-menu-preview');
    } finally {
      setTimeout(() => document.body.classList.remove('print-menu-preview'), 750);
    }
  };

  const handleSaveImage = async () => {
    if (!data) return;

    const template = document.getElementById('menu-image-export');
    if (!template) {
      notifyError('Could not generate image. Please try Print / Save PDF instead.');
      return;
    }

    setSavingImage(true);

    // Clone the hidden template into a temporary body-level wrapper so the
    // browser actually paints it. The wrapper is near-transparent so users
    // won't notice the brief flash. html-to-image captures the clone directly
    // (not the wrapper), so the wrapper opacity doesn't affect the output.
    const wrapper = document.createElement('div');
    wrapper.style.cssText =
      'position:fixed;top:0;left:0;z-index:99999;opacity:0.001;pointer-events:none;overflow:visible;';

    const clone = template.cloneNode(true) as HTMLElement;
    clone.style.position = 'static';
    clone.style.left = '';
    clone.style.top = '';
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    try {
      const logoUrl = `${window.location.origin}/bounce party club logo.png`;
      await preloadImages([logoUrl, ...getUnitImageUrls(data.units)]);
      // One extra frame so the browser paints the appended clone
      await new Promise<void>((r) => setTimeout(r, 80));

      const dataUrl = await toPng(clone, { cacheBust: true, pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = 'bounce-party-club-menu.png';
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error(e);
      notifyError('Could not generate image. Please try Print / Save PDF instead.');
    } finally {
      document.body.removeChild(wrapper);
      setSavingImage(false);
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
    <div className="menu-preview-route min-h-screen bg-slate-50 py-8 px-4">
      {/* Action bar — screen only, excluded from both PDF and image capture */}
      <div className="max-w-5xl mx-auto mb-4 flex items-center justify-between gap-3 no-print">
        <button
          onClick={handleBack}
          className="inline-flex items-center bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-2 px-4 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveImage}
            disabled={savingImage}
            className="inline-flex items-center bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            <Download className="w-4 h-4 mr-2" />
            {savingImage ? 'Saving...' : 'Save as Image'}
          </button>

          <button
            onClick={handlePrint}
            className="inline-flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            <Printer className="w-4 h-4 mr-2" />
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* id="menu-content" — screen preview and PDF print target */}
      <div id="menu-content">
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

          <div className="menu-print-header-right" aria-hidden="true" />
        </div>

        <div className="menu-print-page-number" aria-hidden="true" />

        <div className="menu-print-content max-w-5xl mx-auto">
          <div className="menu-print-grid">
            {(() => {
              const pairs: Unit[][] = [];
              for (let i = 0; i < data.units.length; i += 2) {
                pairs.push(data.units.slice(i, i + 2));
              }
              return pairs.map((pair, rowIdx) => (
                <div
                  key={rowIdx}
                  className={`menu-print-row${rowIdx < pairs.length - 1 ? ' menu-print-row-break' : ''}`}
                >
                  {pair.map((unit) => {
                    const imageUrl = getUnitImageUrl(unit);
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
              ));
            })()}
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

      {/* id="menu-image-export" — off-screen fixed-width canvas for PNG export only */}
      {/* Hidden by CSS: position:absolute left:-9999px — never visible on screen */}
      <div
        id="menu-image-export"
        style={{
          width: '1200px',
          background: '#f8fafc',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {/* Export Header */}
        <div
          style={{
            background: 'linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)',
            padding: '32px 40px 28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '24px',
          }}
        >
          <img
            src="/bounce party club logo.png"
            alt="Bounce Party Club"
            style={{ height: '80px', width: 'auto', objectFit: 'contain' }}
            onError={(e) => ((e.currentTarget.style.display = 'none'))}
          />
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: '30px', fontWeight: 900, color: '#fff', lineHeight: 1.1 }}>
              {data.title || 'Inflatable Price List'}
            </div>
            <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.8)', marginTop: '6px', fontWeight: 600 }}>
              Bounce Party Club · Generated {generatedDate.toLocaleDateString('en-US')}
            </div>
          </div>
          <div style={{ width: '80px' }} />
        </div>

        {/* 3-column card grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '16px',
            padding: '24px 32px',
          }}
        >
          {data.units.map((unit) => {
            const imageUrl = getUnitImageUrl(unit);
            return (
              <div
                key={unit.id}
                style={{
                  background: '#fff',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 2px 8px rgba(15,23,42,0.08)',
                }}
              >
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={unit.name}
                    style={{ width: '100%', height: '170px', objectFit: 'cover', display: 'block' }}
                    onError={(e) => ((e.currentTarget.style.display = 'none'))}
                  />
                ) : (
                  <div style={{ width: '100%', height: '170px', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: '#94a3b8', fontSize: '13px' }}>No image</span>
                  </div>
                )}

                <div style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                      {unit.name}
                    </div>
                    {unit.is_combo ? (
                      <span style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #f59e0b', fontSize: '10px', fontWeight: 800, padding: '2px 6px', borderRadius: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        COMBO
                      </span>
                    ) : null}
                  </div>

                  <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 700, marginBottom: '8px' }}>
                    {unit.type}
                  </div>

                  {unit.dimensions ? (
                    <div style={{ fontSize: '11px', color: '#475569', marginBottom: '8px', fontWeight: 600 }}>
                      {unit.dimensions} · {unit.capacity} kids
                    </div>
                  ) : null}

                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '8px 10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: unit.price_water_cents ? '4px' : '0' }}>
                      <span style={{ fontSize: '14px', fontWeight: 800, color: '#166534' }}>Dry</span>
                      <span style={{ fontSize: '14px', fontWeight: 900, color: '#15803d' }}>{formatCurrency(unit.price_dry_cents)}</span>
                    </div>
                    {unit.price_water_cents ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '14px', fontWeight: 800, color: '#0369a1' }}>Water</span>
                        <span style={{ fontSize: '14px', fontWeight: 900, color: '#0369a1' }}>{formatCurrency(unit.price_water_cents)}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Export Footer */}
        <div
          style={{
            borderTop: '2px solid #e2e8f0',
            padding: '16px 32px',
            textAlign: 'center',
            fontSize: '12px',
            color: '#64748b',
            fontWeight: 600,
            background: '#fff',
          }}
        >
          <strong style={{ color: '#0f172a' }}>Bounce Party Club</strong>
          {' '}· Prices are base rental rates. Delivery/setup fees may apply. Subject to change — confirm at booking.
        </div>
      </div>
    </div>
  );
}
