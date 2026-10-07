import { defineConfig } from 'vite';

export default defineConfig({
  // Shaders are imported as raw strings (`./x.glsl?raw`), no plugin needed.
  assetsInclude: ['**/*.glsl'],
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
