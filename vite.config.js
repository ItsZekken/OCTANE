import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore']
        }
      }
    }
  },
  server: {
    port: 3000,
    open: false,
    host: true,
  },
  preview: {
    port: 4173,
    host: true,
  },
});
