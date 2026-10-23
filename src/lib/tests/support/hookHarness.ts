// A minimal hand-rolled React hooks runner for tests (the repository has no jsdom / react-test-renderer). It drives a hook function through renders:
// useState / useRef / useMemo / useCallback / useEffect / useLayoutEffect behave like React's (dependency comparison with Object.is, effect cleanup
// before the next run, setState re-renders until stable), so tests can check WHEN an effect runs and WHICH closure it sees. It is a test aid, not a
// React replacement: no context, no suspense, no concurrent features.
/* eslint-disable @typescript-eslint/no-explicit-any -- the runner stores heterogeneous hook slots */
import * as React from 'react';

interface Slot { kind: string; [k: string]: any }

export interface HookRun<R> {
  readonly result: R;
  readonly renders: number;
  /** Re-render with new props (props change like a parent re-render). */
  rerender: (props?: any) => R;
  /** Wait for pending async work started by effects (promises), re-rendering after state updates. */
  settle: (ms?: number) => Promise<R>;
}

export function runHook<P, R>(hook: (props: P) => R, initialProps: P): HookRun<R> {
  const slots: Slot[] = [];
  let index = 0;
  let props = initialProps;
  let result!: R;
  let renders = 0;
  let dirty = false;
  let pending: Array<() => void> = [];

  const sameDeps = (a: any[] | undefined, b: any[] | undefined) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

  const dispatcher: any = {
    useState(init: any) {
      const i = index++;
      if (!slots[i]) {
        const slot: Slot = { kind: 'state', v: typeof init === 'function' ? init() : init };
        slot.set = (u: any) => {
          const nv = typeof u === 'function' ? u(slot.v) : u;
          if (!Object.is(nv, slot.v)) { slot.v = nv; dirty = true; }
        };
        slots[i] = slot;
      }
      return [slots[i].v, slots[i].set];
    },
    useRef(init: any) {
      const i = index++;
      if (!slots[i]) slots[i] = { kind: 'ref', ref: { current: init } };
      return slots[i].ref;
    },
    useMemo(fn: () => any, deps?: any[]) {
      const i = index++;
      const s = slots[i];
      if (s && sameDeps(s.deps, deps)) return s.v;
      slots[i] = { kind: 'memo', v: fn(), deps };
      return slots[i].v;
    },
    useCallback(fn: any, deps?: any[]) {
      const i = index++;
      const s = slots[i];
      if (s && sameDeps(s.deps, deps)) return s.fn;
      slots[i] = { kind: 'cb', fn, deps };
      return fn;
    },
    useEffect(fn: () => void | (() => void), deps?: any[]) {
      const i = index++;
      const s = slots[i];
      if (s && deps && sameDeps(s.deps, deps)) return;
      const prev = s;
      slots[i] = { kind: 'effect', deps, cleanup: prev ? prev.cleanup : undefined };
      const slot = slots[i];
      pending.push(() => {
        if (slot.cleanup) { const c = slot.cleanup; slot.cleanup = undefined; c(); }
        const out = fn();
        slot.cleanup = typeof out === 'function' ? out : undefined;
      });
    },
    useDebugValue() {},
    useId() { return 'id'; },
  };
  dispatcher.useLayoutEffect = dispatcher.useEffect;

  const internals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;

  function render(): R {
    for (let guard = 0; guard < 60; guard++) {
      const prevDispatcher = internals.current;
      internals.current = dispatcher;
      index = 0;
      dirty = false;
      pending = [];
      try {
        result = hook(props);
        renders++;
      } finally {
        internals.current = prevDispatcher;
      }
      const toRun = pending;
      pending = [];
      for (const run of toRun) run();
      if (!dirty) return result;
    }
    throw new Error('render loop did not settle');
  }

  render();
  return {
    get result() { return result; },
    get renders() { return renders; },
    rerender(next?: any) { if (next !== undefined) props = next; return render(); },
    async settle(ms = 20) {
      // let promise continuations run, then re-render whenever they changed state
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, ms));
        if (dirty) render();
      }
      return result;
    },
  };
}

// Loads a hook (or any TS module) from source with the given module replacements, the way the other handler tests load Edge Functions:
// the file is transpiled with the TypeScript compiler and evaluated with a custom `require`. Keys of `mocks` are matched against the import
// specifier text exactly; any other specifier is resolved with the real `require` (bare packages) or must be listed.
export function loadModuleWithMocks(file: string, mocks: Record<string, unknown>): any {
  const fs = require('fs');
  const ts = require('typescript');
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod: { exports: any } = { exports: {} };
  const req = (id: string) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith('.')) throw new Error(`loadModuleWithMocks: unmocked relative import "${id}" in ${file}`);
    return require(id);
  };
  new Function('require', 'module', 'exports', out)(req, mod, mod.exports);
  return mod.exports;
}
declare const require: (id: string) => any;
