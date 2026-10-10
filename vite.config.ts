import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** A short hash of every source file the builder's output depends on, sorted by path: the key its cached bodies live under. */
function builderHash(): string {
  const files = ['src/builder', 'src/recipe', 'src/util']
    .flatMap((d) => readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => `${e.parentPath}/${e.name}`.replaceAll('\\', '/')))
    .sort();
  const h = createHash('sha1');
  for (const f of files) h.update(`${f}\n${readFileSync(f, 'utf8').replaceAll('\r\n', '\n')}\n`);
  return h.digest('hex').slice(0, 12);
}

/** Defines `__BUILDER_HASH__`; in dev, a change to the builder's source restarts the server so cached bodies of the old code are never used. */
function builderHashDefine(): Plugin {
  let hash = '';
  return {
    name: 'builder-hash',
    config() {
      hash = builderHash();
      return { define: { __BUILDER_HASH__: JSON.stringify(hash) } };
    },
    configureServer(server) {
      if (process.env.VITEST) return;
      const check = (f: string) => {
        if (/\/src\/(builder|recipe|util)\//.test(f.replaceAll('\\', '/')) && builderHash() !== hash) void server.restart();
      };
      for (const ev of ['change', 'add', 'unlink'] as const) server.watcher.on(ev, check);
    },
  };
}

export default defineConfig({
  plugins: [shots(), builderHashDefine()],
  server: { port: 5180, strictPort: true, proxy: { '/api': 'http://localhost:8787' } },
  worker: { format: 'es' },
  build: { target: 'es2023', chunkSizeWarningLimit: 1500, rollupOptions: { input: { valley: 'index.html', lab: 'lab.html', drawings: 'drawings.html' } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
