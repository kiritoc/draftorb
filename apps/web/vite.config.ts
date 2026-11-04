import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** In development, mirror the exported data tree (`data/public`) at the root
 *  so the loader can fetch `latest.json` and manifest/role files just like the
 *  statically hosted production build (where `data/public` is the web root). */
const DATA_PUBLIC_DIR = join(process.cwd(), '..', '..', 'data', 'public');

function serveExportedData(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const url = new URL(req.url ?? '', 'http://localhost');
  const filePath = join(DATA_PUBLIC_DIR, url.pathname.replace(/^\//, ''));
  try {
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
