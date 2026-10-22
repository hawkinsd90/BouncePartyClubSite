// WP-33 / NI-12: Party Add-Ons in the downloadable and saved menu, verified by EXECUTING the real MenuPreview source:
//   - the screen/print DOM (server-rendered with saved menu data),
//   - the image export (the real drawMenuToCanvas against a recording fake 2D canvas),
//   - an older saved menu without add-ons (unchanged).
// PASS - LOCAL AUTOMATED. A real browser print preview, PDF and PNG on a phone are REQUIRES HOSTED DEV VERIFICATION.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;
const fs = require('fs');
const path = require('path');
const tsc = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const { createElement } = require('react');
const { StaticRouter } = require('react-router-dom/server');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}\n  got:      ${g}\n  expected: ${w}`);
  }
}

const g = globalThis as any;
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
g.sessionStorage = memory();
g.window = { location: { origin: 'https://site.test', hash: '', search: '', pathname: '/menu-preview' }, addEventListener() {}, removeEventListener() {}, sessionStorage: g.sessionStorage };

const tsxCache: Record<string, any> = {};
function loadTsx(file: string, patch?: (js: string) => string): any {
  const abs = path.resolve(file);
  if (!patch && tsxCache[abs]) return tsxCache[abs];
  let out = tsc.transpileModule(fs.readFileSync(abs, 'utf8'), { compilerOptions: { jsx: tsc.JsxEmit.ReactJSX, module: tsc.ModuleKind.CommonJS, target: tsc.ScriptTarget.ES2020, esModuleInterop: true } }).outputText.split('import.meta.env').join('({})');
  if (patch) out = patch(out);
  const mod: any = { exports: {} };
  if (!patch) tsxCache[abs] = mod.exports;
  const req = (id: string) => {
    if (!id.startsWith('.')) return require(id);
    const base = path.resolve(path.dirname(abs), id);
    return fs.existsSync(base + '.tsx') ? loadTsx(base + '.tsx') : require(base);
  };
  new Function('require', 'module', 'exports', out)(req, mod, mod.exports);
  return mod.exports;
}

const unit = (i: number) => ({ id: `u${i}`, name: `Castle ${i}`, types: ['Bounce House'], is_combo: false, price_dry_cents: 15000, price_water_cents: null, dimensions: '13x13', footprint_sqft: 169, capacity: 8, quantity_available: 1, media: [] });
const addOn = (i: number, extra: any = {}) => ({ id: `a${i}`, kind: 'product', name: `Table ${i}`, categoryName: 'Tables', priceCents: 2500 + i, priceKind: 'standalone', imageUrl: null, ...extra });

// A recording fake 2D canvas.
function fakeDocument() {
  const calls: Array<[string, any[]]> = [];
  const ctx: any = new Proxy({}, {
    get: (_t, k: string) => (k === 'measureText' ? (s: string) => ({ width: String(s).length * 6 }) : (...a: any[]) => { calls.push([k, a]); return /Gradient$/.test(k) ? { addColorStop() {} } : undefined; }),
    set: () => true,
  });
  const canvas: any = { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,AAAA' };
  return { calls, canvas, document: { createElement: (tag: string) => { if (tag !== 'canvas') throw new Error('unexpected element ' + tag); return canvas; } } };
}

async function draw(data: any) {
  const mod = loadTsx('src/pages/MenuPreview.tsx', (js) => {
    if (!/async function drawMenuToCanvas/.test(js)) throw new Error('drawMenuToCanvas not found');
    return js + '\nexports.__draw = drawMenuToCanvas;';
  });
  const fake = fakeDocument();
  g.document = fake.document;
  const url = await mod.__draw(data, null, data.units.map(() => null), (data.addOns ?? []).map(() => null));
  const texts = fake.calls.filter(([k]) => k === 'fillText').map(([, a]) => String(a[0]));
  return { url, texts, height: fake.canvas.height };
}

function renderMenu(data: any): string {
  const mod = loadTsx('src/pages/MenuPreview.tsx', (js) => {
    const patched = js.replace('react_1.useState)(null)', 'react_1.useState)(globalThis.__menuData)');
    if (patched === js) throw new Error('could not seed MenuPreview state');
    return patched;
  });
  g.__menuData = data;
  return renderToStaticMarkup(createElement(StaticRouter, { location: '/menu-preview' }, createElement(mod.MenuPreview)));
}

async function main() {
  const units = [unit(1), unit(2), unit(3), unit(4)];
  const addOns = Array.from({ length: 8 }, (_, i) => addOn(i + 1));
  const base = { generatedAtIso: '2026-07-10T00:00:00.000Z', title: 'Bounce Party Club Menu', units, availabilityChecked: false, availabilityDateFormatted: null, activeFilter: null };

  // --- print / screen DOM ---
  const withAddOns = renderMenu({ ...base, addOns });
  ok('print/screen: a "Party Add-Ons" heading and all 8 add-ons are rendered', /menu-addons-title">Party Add-Ons</.test(withAddOns) && addOns.every((a) => withAddOns.includes(`>${a.name}<`)));
  ok('print/screen: prices are shown with the right label', />Price</.test(withAddOns) && /\$25\.01|\$25\.1/.test(withAddOns));
  ok('print/screen: 8 add-ons make two pages (PAGE_SIZE 6) with a page break between them and only one heading', (withAddOns.match(/menu-print-page-group menu-print-page-break/g) ?? []).length >= 1 && (withAddOns.match(/menu-addons-title/g) ?? []).length === 1);
  const without = renderMenu({ ...base });
  ok('an older saved menu (no addOns) has no add-ons section at all', !/menu-addons-title/.test(without) && !/menu-print-addons/.test(without));
  const emptyAddOns = renderMenu({ ...base, addOns: [] });
  ok('an empty add-ons list renders no section', !/menu-addons-title/.test(emptyAddOns));
  ok('inflatable cards are unchanged by add-ons', units.every((u) => withAddOns.includes(`>${u.name}<`)) && units.every((u) => without.includes(`>${u.name}<`)));
  const addOnAddOnPrice = renderMenu({ ...base, addOns: [addOn(1, { priceKind: 'add-on' })] });
  ok('an add-on-only price is labelled "Add-on price"', />Add-on price</.test(addOnAddOnPrice));

  // --- image export (canvas) ---
  const withImg = await draw({ ...base, addOns });
  ok('image: the heading and every add-on name are drawn', withImg.texts.includes('Party Add-Ons') && addOns.every((a) => withImg.texts.includes(a.name)));
  const plainImg = await draw({ ...base });
  ok('image: no heading without add-ons', !plainImg.texts.includes('Party Add-Ons'));
  ok('image: the canvas is taller with add-ons and exactly as tall as before without them', withImg.height > plainImg.height && plainImg.height === (140 + 32 + (Math.ceil(4 / 3) * 320 + 16) + 32 + 56) * 2);
  // 8 add-ons in 3 columns = 3 rows of (110 + 78) + 2 gaps; heading band 56; bottom pad 32.
  eq('image: the extra height is exactly the add-on section', (withImg.height - plainImg.height) / 2, 56 + (3 * 188 + 2 * 16) + 32);
  ok('image: a data URL comes back', /^data:image\/png/.test(withImg.url));
  const filtered = await draw({ ...base, activeFilter: 'Bounce Houses', addOns: [] });
  ok('image: a filtered menu (no add-ons) stays an inflatable-only image', !filtered.texts.includes('Party Add-Ons'));

  // --- what the catalog hands to the preview ---
  const catalog = fs.readFileSync('src/pages/Catalog.tsx', 'utf8').replace(/\r\n/g, '\n');
  ok('the saved menu data carries addOns into session storage for the preview', /addOns,\n\s+availabilityChecked/.test(catalog) && /sessionStorage\.setItem\('menu-preview-data', JSON\.stringify\(menuData\)\)/.test(catalog));

  console.log(`menuExport: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} menu export test(s) failed`);
}
main();
