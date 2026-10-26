import { defineConfig } from 'vite';

// Space Telescope Live's current-observation feed has no CORS headers: the
// browser asks this server for /stl/hubble or /stl/webb, which asks the site.
const stlProxy = {
  '/stl': {
    target: 'https://spacetelescopelive.org',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/stl\/(hubble|webb)\b.*$/, '/api/get/$1'),
    headers: { endpoint: 'current' },
  },
};

export default defineConfig({
  // Shaders are imported as raw strings (`./x.glsl?raw`), no plugin needed.
  assetsInclude: ['**/*.glsl'],
  server: {
    port: 5173,
    open: false,
    proxy: stlProxy,
  },
  preview: { proxy: stlProxy },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
