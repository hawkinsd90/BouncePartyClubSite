// PrintModal keyboard shortcuts. The listener is bound once per isOpen / onClose, so it used to keep the zoom and the "already printing" flag of the
// render that created it: Ctrl+= twice stopped at 125%, Ctrl+P twice quickly started two print runs, and a replaced onBeforePrint was never seen.
// The component is executed for real with the repository's hand-rolled hooks runner (src/lib/tests/support/hookHarness.ts).
/* eslint-disable @typescript-eslint/no-explicit-any -- React element trees and scripted browser globals */
import * as modalClasses from '../../lib/core/modalClasses';
import * as printableDocument from '../../lib/documents/printableDocument';
import { runHook, loadModuleWithMocks } from '../../lib/tests/support/hookHarness';

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined>; exit: (code: number) => never };

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

// --- scripted browser globals -----------------------------------------------------------------------------------------------------------
const listeners = new Set<(e: any) => void>();
let printCalls = 0;
const g = globalThis as any;
g.window = {
  addEventListener: (type: string, fn: (e: any) => void) => { if (type === 'keydown') listeners.add(fn); },
  removeEventListener: (type: string, fn: (e: any) => void) => { if (type === 'keydown') listeners.delete(fn); },
  print: () => { printCalls++; },
};
g.document = {
  createElement: () => ({ setAttribute() {}, className: '', textContent: '' }),
  body: { appendChild() {}, removeChild() {} },
};
const press = (key: string, extra: Record<string, unknown> = {}) => {
  const event = { key, ctrlKey: true, metaKey: false, preventDefault() {}, ...extra };
  for (const fn of [...listeners]) fn(event);
};

// --- the component under test -------------------------------------------------------------------------------------------------------------
const icon = () => null;
const lucide = new Proxy({}, { get: () => icon });
const printZoom = require('fs').existsSync('src/lib/core/printZoom.ts') ? require('../../lib/core/printZoom') : {};
const FILE = process.env.PRINTMODAL_FILE_UNDER_TEST || 'src/components/common/PrintModal.tsx';
const { PrintModal } = loadModuleWithMocks(FILE, {
  react: require('react'),
  'react/jsx-runtime': require('react/jsx-runtime'),
  'lucide-react': lucide,
  '../../lib/core/modalClasses': modalClasses,
  '../../lib/documents/printableDocument': printableDocument,
  '../../lib/core/printZoom': printZoom,
});

// reads the preview scale out of the rendered element tree (the content wrapper carries transform: scale(zoom / 100))
function zoomOf(node: any): number | null {
  if (!node || typeof node !== 'object') return null;
  const t = node.props?.style?.transform;
  if (typeof t === 'string') {
    const m = /scale\(([\d.]+)\)/.exec(t);
    if (m) return Math.round(Number(m[1]) * 100);
  }
  const kids = node.props?.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const z = zoomOf(k);
    if (z !== null) return z;
  }
  return null;
}

const baseProps = (over: Record<string, unknown> = {}) => ({ isOpen: true, onClose: () => {}, children: null, ...over });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. zoom shortcuts move from where the zoom is NOW
  {
    listeners.clear();
    const run = runHook<any, any>(PrintModal, baseProps());
    ok('opens at 100%', zoomOf(run.result) === 100);
    press('=');
    run.rerender();
    ok('Ctrl+= once: 125%', zoomOf(run.result) === 125);
    press('=');
    run.rerender();
    ok('Ctrl+= twice: 150% (the listener must not keep the zoom of an older render)', zoomOf(run.result) === 150);
    press('+');
    run.rerender();
    ok('Ctrl++ at the top: stays at 150%', zoomOf(run.result) === 150);
    press('-');
    run.rerender();
    press('-');
    run.rerender();
    ok('Ctrl+- twice from 150%: 100%', zoomOf(run.result) === 100);
    press('-');
    run.rerender();
    press('-');
    run.rerender();
    press('-');
    run.rerender();
    ok('Ctrl+- repeatedly stops at 50%', zoomOf(run.result) === 50);
    press('0');
    run.rerender();
    ok('Ctrl+0 resets to 100%', zoomOf(run.result) === 100);
  }

  // 2. a second Ctrl+P while the first print run is in progress does nothing; a later one prints again
  {
    listeners.clear();
    printCalls = 0;
    const run = runHook<any, any>(PrintModal, baseProps());
    press('p');
    press('p');
    await wait(180);
    ok('Ctrl+P twice quickly: exactly one print run', printCalls === 1);
    run.rerender();
    press('p');
    await wait(180);
    ok('after the first run finished a new Ctrl+P prints again', printCalls === 2);
  }

  // 3. the shortcut calls the callbacks of the latest render, not the ones from when the listener was bound
  {
    listeners.clear();
    printCalls = 0;
    const seen: string[] = [];
    const run = runHook(PrintModal, baseProps({ onBeforePrint: () => { seen.push('old'); } }));
    run.rerender(baseProps({ onBeforePrint: () => { seen.push('new'); } }));
    press('p');
    await wait(180);
    ok('a replaced onBeforePrint is the one that runs', seen.join() === 'new');
  }

  // 4. Escape still closes; a closed modal ignores the shortcuts
  {
    listeners.clear();
    let closed = 0;
    const run = runHook(PrintModal, baseProps({ onClose: () => { closed++; } }));
    press('Escape', { ctrlKey: false });
    ok('Escape calls onClose', closed === 1);
    listeners.clear(); // only the closed modal is mounted from here on
    const closedRun = runHook(PrintModal, baseProps({ isOpen: false }));
    printCalls = 0;
    press('p');
    await wait(150);
    ok('a closed modal renders nothing and does not print', closedRun.result === null && printCalls === 0);
    void run;
  }

  console.log(`PrintModal: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} PrintModal test(s) failed`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
