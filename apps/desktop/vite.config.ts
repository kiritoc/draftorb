import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'ui',
  plugins: [react()],
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: fileURLToPath(new URL('./tailwind.config.ts', import.meta.url)) }),
        autoprefixer(),
      ],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
