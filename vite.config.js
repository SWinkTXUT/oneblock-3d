import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './', // GitHub Pages serves the game from a sub-path, so every URL must be relative
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        computer: resolve(import.meta.dirname, 'computer.html'),
        xbox: resolve(import.meta.dirname, 'xbox.html'),
        ipad: resolve(import.meta.dirname, 'ipad.html'),
        demo: resolve(import.meta.dirname, 'demo.html'),
      },
    },
  },
});
