import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

/**
 * The Quest browser requires HTTPS for WebXR, even on a LAN, so the dev server
 * runs with a self-signed certificate and binds to every interface.
 *
 * `/sync` is proxied through to the hub so the headset opens a WSS socket on the
 * same origin as the page. Connecting straight to a plain ws:// hub from an
 * HTTPS page would be blocked as mixed content, and a second certificate would
 * mean a second trust prompt on the headset.
 */
const API_PORT = process.env['API_PORT'] ?? '8787';

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/sync': { target: `ws://localhost:${API_PORT}`, ws: true, changeOrigin: true },
      '/health': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
  assetsInclude: ['**/*.yaml'],
});
