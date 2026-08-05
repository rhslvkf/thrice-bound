import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const resolvePath = (path: string): string =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Game portals (CrazyGames / Poki) serve the build from an arbitrary
  // subdirectory, so every asset URL must be relative.
  base: './',
  resolve: {
    alias: {
      '@core': resolvePath('./src/core'),
      '@data': resolvePath('./src/data'),
      '@render': resolvePath('./src/render'),
      '@ui': resolvePath('./src/ui'),
      '@audio': resolvePath('./src/audio'),
      '@meta': resolvePath('./src/meta'),
    },
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    // Portal review flags oversized initial payloads; keep the warning low
    // enough that regressions surface during development, not at submission.
    chunkSizeWarningLimit: 1024,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
