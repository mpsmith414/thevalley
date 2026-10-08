import { mkdirSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';

/** Dev only: POST a PNG data URL to /__shot?name=x and it is saved as .shots/x.png (for checking work). */
function shots(): Plugin {
  return {
    name: 'dev-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'shot').replace(/[^\w-]/g, '_');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const data = Buffer.concat(chunks).toString().replace(/^data:image\/png;base64,/, '');
          mkdirSync('.shots', { recursive: true });
          writeFileSync(`.shots/${name}.png`, Buffer.from(data, 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [shots()],
  server: { port: 5180, strictPort: true, proxy: { '/api': 'http://localhost:8787' } },
  worker: { format: 'es' },
  build: { target: 'es2023', chunkSizeWarningLimit: 1500, rollupOptions: { input: { valley: 'index.html', lab: 'lab.html', drawings: 'drawings.html' } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
