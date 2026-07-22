// Preload script: polyfills import.meta.env for all ESM modules under Node.
// This runs before any other module via --import.
// We monkey-patch the Module system to inject import.meta.env.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Register a custom loader that injects import.meta.env into every module
register('./scripts/env-loader.mjs', pathToFileURL('./'));
