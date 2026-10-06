import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

/**
 * Third-party runtime modules are marked external so they are `require`d at
 * runtime from node_modules (they contain native/dynamic requires that do not
 * bundle cleanly). They are declared in package.json "dependencies" so
 * electron-builder ships them inside the packaged app.
 */
const externalDeps = ['electron', 'imapflow', 'mailparser', 'otplib', 'electron-store'];

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            minify: false,
            sourcemap: false,
            rollupOptions: { external: externalDeps },
          },
        },
      },
      preload: {
        input: path.resolve(process.cwd(), 'electron/preload.ts'),
        vite: {
          build: {
            outDir: 'dist-electron',
            minify: false,
            sourcemap: false,
            rollupOptions: { external: externalDeps },
          },
        },
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
