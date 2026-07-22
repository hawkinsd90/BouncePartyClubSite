// Custom ESM loader that injects import.meta.env and window polyfill
// into every module's source before compilation.
export async function load(url, context, defaultLoad) {
  const result = await defaultLoad(url, context);
  if (result.source) {
    let srcText;
    if (typeof result.source === 'string') {
      srcText = result.source;
    } else if (result.source instanceof Uint8Array) {
      srcText = new TextDecoder().decode(result.source);
    } else {
      srcText = null;
    }
    if (srcText) {
      const polyfill = [
        'if (!import.meta.env) { import.meta.env = { VITE_SUPABASE_URL: "https://test.supabase.co", VITE_SUPABASE_ANON_KEY: "test-anon-key" }; }',
        'if (typeof globalThis.window === "undefined") { globalThis.window = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, location: { origin: "https://test.supabase.co" } }; }',
        '',
      ].join('\n');
      result.source = polyfill + srcText;
    }
  }
  return result;
}
