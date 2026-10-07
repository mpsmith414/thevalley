import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:8787' } },
  worker: { format: 'es' },
  build: { target: 'es2023', rollupOptions: { input: { lab: 'index.html', drawings: 'drawings.html' } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
