import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, Download } from 'lucide-react';
import { notifyError } from '../lib/notifications';

type Unit = {
  id: string;
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
  media: Array<{ url: string; alt: string; mode?: string | null; is_featured?: boolean | null }>;
};

type MenuPreviewData = {
  generatedAtIso: string;
  units: Unit[];
  title?: string;
};

function formatCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function getUnitTypeLabel(unit: Unit): string {
  if (unit.types?.length) return unit.types.join(' • ');
  if (unit.type) return unit.type;
  return '';
}

function isCombo(unit: Unit): boolean {
  return unit.is_combo === true || (unit.types || []).includes('Combo');
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

// Load an image for canvas drawing.
// First attempts with crossOrigin='anonymous' (works when the server sends CORS headers,
// keeps the canvas untainted). On failure retries without the attribute — this always works
// for display but may taint the canvas on some origins. The toPng/toBlob path still succeeds
// in all modern browsers when the image was served with a public URL (Supabase storage is public).
function loadImageForCanvas(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const withCors = new Image();
    withCors.crossOrigin = 'anonymous';
    withCors.onload = () => resolve(withCors);
    withCors.onerror = () => {
      const noCors = new Image();
      noCors.onload = () => resolve(noCors);
      noCors.onerror = () => resolve(null);
      noCors.src = src;
    };
    withCors.src = src;
  });
}

// Draw a rounded rectangle path on a canvas context
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Wrap text and return lines that fit within maxWidth
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Draw the full menu onto a canvas and return it as a PNG data URL.
// All drawing is pure Canvas 2D — no DOM capture, no html-to-image, no CORS issues.
async function drawMenuToCanvas(
  data: MenuPreviewData,
  logoImg: HTMLImageElement | null,
  unitImages: (HTMLImageElement | null)[]
): Promise<string> {
  const SCALE = 2; // retina
  const W = 1200;
  const COLS = 3;
  const PAD = 32;
  const GAP = 16;
  const HEADER_H = 140;
  const IMG_H = 160;
  const CARD_CONTENT_H = 160; // text area per card
  const CARD_H = IMG_H + CARD_CONTENT_H;
  const CARD_W = Math.floor((W - PAD * 2 - GAP * (COLS - 1)) / COLS);
  const FOOTER_H = 56;
  const ROWS = Math.ceil(data.units.length / COLS);
  const GRID_H = ROWS * CARD_H + (ROWS - 1) * GAP;
  const TOTAL_H = HEADER_H + PAD + GRID_H + PAD + FOOTER_H;

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = TOTAL_H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);

  // Background
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, TOTAL_H);

  // --- Header gradient ---
  const grad = ctx.createLinearGradient(0, 0, W, HEADER_H);
  grad.addColorStop(0, '#1d4ed8');
  grad.addColorStop(1, '#0891b2');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, HEADER_H);

  // Logo in header
  let logoRight = PAD;
  if (logoImg) {
    const logoH = 72;
    const logoW = Math.round((logoImg.naturalWidth / logoImg.naturalHeight) * logoH);
    const lx = PAD;
    const ly = (HEADER_H - logoH) / 2;
    ctx.drawImage(logoImg, lx, ly, logoW, logoH);
    logoRight = lx + logoW + 16;
  }

  // Title in header
  const titleX = W / 2;
  const generatedDate = new Date(data.generatedAtIso);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 30px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.fillText(data.title || 'Inflatable Price List', titleX, HEADER_H / 2 + 6);
  ctx.font = `600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillText(
    `bouncepartyclub.com  ·  Generated ${generatedDate.toLocaleDateString('en-US')}`,
    titleX,
    HEADER_H / 2 + 28
  );
  ctx.textAlign = 'left';

  // Suppress unused variable warning
  void logoRight;

  // --- Unit cards ---
  let cardY = HEADER_H + PAD;

  for (let i = 0; i < data.units.length; i++) {
    const unit = data.units[i];
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cx = PAD + col * (CARD_W + GAP);
    const cy = cardY + row * (CARD_H + GAP);

    // Card shadow (simulated with offset fill)
    ctx.fillStyle = 'rgba(15,23,42,0.07)';
    roundRect(ctx, cx + 2, cy + 3, CARD_W, CARD_H, 12);
    ctx.fill();

    // Card background
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, cx, cy, CARD_W, CARD_H, 12);
    ctx.fill();

    // Card border
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    roundRect(ctx, cx, cy, CARD_W, CARD_H, 12);
    ctx.stroke();

    // Unit image (clipped to top of card with rounded top corners)
    const unitImg = unitImages[i];
    ctx.save();
    roundRect(ctx, cx, cy, CARD_W, IMG_H, 12);
    // Square off bottom corners of the image clip
    ctx.rect(cx, cy + IMG_H - 12, CARD_W, 12);
    ctx.clip();
    if (unitImg) {
      // cover: scale to fill, center crop
      const iRatio = unitImg.naturalWidth / unitImg.naturalHeight;
      const cRatio = CARD_W / IMG_H;
      let sw = unitImg.naturalWidth, sh = unitImg.naturalHeight;
      let sx = 0, sy = 0;
      if (iRatio > cRatio) {
        sw = Math.round(sh * cRatio);
        sx = Math.round((unitImg.naturalWidth - sw) / 2);
      } else {
        sh = Math.round(sw / cRatio);
        sy = Math.round((unitImg.naturalHeight - sh) / 2);
      }
      ctx.drawImage(unitImg, sx, sy, sw, sh, cx, cy, CARD_W, IMG_H);
    } else {
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(cx, cy, CARD_W, IMG_H);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No image', cx + CARD_W / 2, cy + IMG_H / 2 + 5);
      ctx.textAlign = 'left';
    }
    ctx.restore();

    // Card text area
    const tx = cx + 12;
    let ty = cy + IMG_H + 14;
    const textW = CARD_W - 24;

    // Unit name
    ctx.fillStyle = '#0f172a';
    ctx.font = `800 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    const nameLines = wrapText(ctx, unit.name, textW - (isCombo(unit) ? 58 : 0));
    nameLines.slice(0, 2).forEach((line, li) => {
      ctx.fillText(line, tx, ty + li * 18);
    });

    // COMBO badge
    if (isCombo(unit)) {
      const badgeX = cx + CARD_W - 12 - 52;
      const badgeY = cy + IMG_H + 6;
      ctx.fillStyle = '#fef3c7';
      roundRect(ctx, badgeX, badgeY, 52, 18, 4);
      ctx.fill();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1;
      roundRect(ctx, badgeX, badgeY, 52, 18, 4);
      ctx.stroke();
      ctx.fillStyle = '#92400e';
      ctx.font = `800 9px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('COMBO', badgeX + 26, badgeY + 12);
      ctx.textAlign = 'left';
    }

    ty += Math.min(nameLines.length, 2) * 18 + 2;

    // Type
    ctx.fillStyle = '#64748b';
    ctx.font = `700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillText(getUnitTypeLabel(unit), tx, ty);
    ty += 16;

    // Divider
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + textW, ty);
    ctx.stroke();
    ty += 10;

    // Details rows
    const details: [string, string][] = [
      ['Dimensions', unit.dimensions || 'N/A'],
      ['Footprint', `${unit.footprint_sqft} sq ft`],
      ['Capacity', `${unit.capacity} kids`],
    ];
    ctx.font = `600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    for (const [label, value] of details) {
      ctx.fillStyle = '#64748b';
      ctx.fillText(label, tx, ty);
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'right';
      ctx.fillText(value, tx + textW, ty);
      ctx.textAlign = 'left';
      ty += 15;
    }

    ty += 4;

    // Pricing box
    const pricingH = unit.price_water_cents ? 46 : 28;
    ctx.fillStyle = '#f0fdf4';
    roundRect(ctx, tx, ty, textW, pricingH, 6);
    ctx.fill();
    ctx.strokeStyle = '#86efac';
    ctx.lineWidth = 1;
    roundRect(ctx, tx, ty, textW, pricingH, 6);
    ctx.stroke();

    ty += 10;
    ctx.font = `800 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillStyle = '#166534';
    ctx.fillText('Dry', tx + 8, ty);
    ctx.fillStyle = '#15803d';
    ctx.textAlign = 'right';
    ctx.fillText(formatCurrency(unit.price_dry_cents), tx + textW - 8, ty);
    ctx.textAlign = 'left';

    if (unit.price_water_cents) {
      ty += 18;
      ctx.fillStyle = '#0369a1';
      ctx.fillText('Water', tx + 8, ty);
      ctx.textAlign = 'right';
      ctx.fillText(formatCurrency(unit.price_water_cents), tx + textW - 8, ty);
      ctx.textAlign = 'left';
    }
  }

  // --- Footer ---
  const fy = HEADER_H + PAD + GRID_H + PAD;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, fy, W, FOOTER_H);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, fy);
  ctx.lineTo(W, fy);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.font = `700 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.fillStyle = '#0f172a';
  ctx.fillText('Bounce Party Club  ·  bouncepartyclub.com', W / 2, fy + 22);
  ctx.font = `500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.fillStyle = '#64748b';
  ctx.fillText(
    'Prices are base rental rates. Delivery/setup fees may apply. Subject to change — confirm at booking.',
    W / 2,
    fy + 38
  );
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png');
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
    setSavingImage(true);

    try {
      const logoUrl = `${window.location.origin}/bounce party club logo.png`;

      const [logoImg, ...unitImgs] = await Promise.all([
        loadImageForCanvas(logoUrl),
        ...data.units.map((u) => loadImageForCanvas(getUnitImageUrl(u))),
      ]);

      const dataUrl = await drawMenuToCanvas(data, logoImg, unitImgs);

      // Convert to Blob so we can use the Web Share API (works on iOS/Android)
      // and also get an object URL for the desktop anchor download.
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], 'bounce-party-club-menu.png', { type: 'image/png' });

      // Web Share API with files triggers the native save sheet on iOS 15+ / Android Chrome.
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Bounce Party Club Menu' });
      } else {
        // Desktop fallback
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = 'bounce-party-club-menu.png';
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        console.error(e);
        notifyError('Could not save image. Please try Print / Save PDF instead.');
      }
    } finally {
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
      {/* Action bar — screen only, excluded from PDF */}
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

      {/* Screen preview and PDF print target */}
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
              bouncepartyclub.com · Generated {generatedDate.toLocaleDateString('en-US')}
            </div>
          </div>

          <div className="menu-print-header-right" aria-hidden="true" />
        </div>

        <div className="menu-print-page-number" aria-hidden="true" />

        <div className="menu-print-content max-w-5xl mx-auto">
          {(() => {
            // Group units into pages of 6 (2 rows × 3 cols in print layout).
            // Each page group gets its own grid so break-after goes on a real
            // block container — not on a grid item — which works reliably on mobile.
            const PAGE_SIZE = 6;
            const pages: Unit[][] = [];
            for (let i = 0; i < data.units.length; i += PAGE_SIZE) {
              pages.push(data.units.slice(i, i + PAGE_SIZE));
            }

            // Screen layout uses 2 columns so rows hold 2 units each.
            function buildRows(units: Unit[]): Unit[][] {
              const rows: Unit[][] = [];
              for (let i = 0; i < units.length; i += 2) rows.push(units.slice(i, i + 2));
              return rows;
            }

            return pages.map((pageUnits, pageIdx) => (
              <div
                key={pageIdx}
                className={`menu-print-page-group${pageIdx < pages.length - 1 ? ' menu-print-page-break' : ''}`}
              >
                <div className="menu-print-grid">
                  {buildRows(pageUnits).map((pair, rowIdx) => (
                    <div key={rowIdx} className="menu-print-row">
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
                              {isCombo(unit) ? <div className="menu-unit-badge">COMBO</div> : null}
                            </div>

                            <div className="menu-unit-type">{getUnitTypeLabel(unit)}</div>

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
                  ))}
                </div>
              </div>
            ));
          })()}


          <div className="menu-print-footer">
            <div>
              <strong>Bounce Party Club</strong> · bouncepartyclub.com · Prices shown are base rental rates. Delivery/setup
              fees may apply.
            </div>
            <div className="menu-print-footer-muted">
              Prices are subject to change. Please confirm final pricing at booking.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
