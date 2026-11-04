import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveDataPath } from './src/dev/data-path';

/** In development, mirror the exported data tree (`data/public`) at the root
 *  so the loader can fetch `latest.json` and manifest/role files just like the
 *  statically hosted production build (where `data/public` is the web root). */
const DATA_PUBLIC_DIR = join(process.cwd(), '..', '..', 'data', 'public');
const CHAMPION_TAGS_PATH = join(process.cwd(), '..', '..', 'data', 'manual', 'champion-tags.json');

function serveExportedData(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }
  try {
    const url = new URL(req.url ?? '', 'http://localhost');
    const filePath = resolveDataPath(url.pathname, DATA_PUBLIC_DIR, CHAMPION_TAGS_PATH);
    if (filePath === null) {
      next();
      return;
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      next();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    createReadStream(filePath).pipe(res);
  } catch {
    next();
  }
}

const dataServerPlugin = {
  name: 'draftorb:serve-exported-data',
  configureServer(server: {
    middlewares: {
      use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
    };
  }): void {
    server.middlewares.use(serveExportedData);
  },
};

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), dataServerPlugin],
  build: {
    outDir: 'dist',
  },
});
