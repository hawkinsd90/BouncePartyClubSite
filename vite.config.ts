import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error plain ESM helper shared with the guard test
import { assertNotProductionBackend } from './scripts/dev/production-backend-guard.mjs';

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Local dev / preview servers must not be pointed at the Production project by accident (builds are unaffected).
  assertNotProductionBackend({
    command,
    env: loadEnv(mode, '.', 'VITE_'),
    shellEnv: (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {},
  });
  return {
    plugins: [react()],
    optimizeDeps: {
      exclude: ['lucide-react'],
    },
  };
});
