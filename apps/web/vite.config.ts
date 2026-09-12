import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Plain HTTP is enough now: the headset is a native Unity/OVR build, not a
 * browser opening this page, so there is no WebXR HTTPS requirement and no
 * mixed-content restriction on connecting to the plain `ws://` Quest bridge
 * (`socket-server/`, default :3001) or the CircuitGit sync hub below.
 */
const API_PORT = process.env['API_PORT'] ?? '8787';

export default defineConfig({
  plugins: [react()],
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
