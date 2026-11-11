import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the same build works on GitHub Pages, Cloudflare Pages and inside Capacitor.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
