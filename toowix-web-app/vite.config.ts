import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // P2-9 fix (2G/3G performance plan): scripts/bundle-report.cjs (run after every build) reads
  // this manifest to tell "initial" chunks (root entry's own static import graph) apart from
  // route-split ones (MeetingRoomPage's own chunk, loaded only on a meeting route) and from
  // on-demand ones (virtual background's MediaPipe/model code, loaded only if that feature is
  // actually turned on). Vite already fingerprints/code-splits everything the same way with or
  // without this flag -- it only adds one extra, small JSON file to dist/.vite/manifest.json
  // describing the real output graph; zero change to what ships to a browser.
  build: {
    manifest: true,
  },
  server: {
    port: 3000,
    watch: {
      ignored: ['**/.browser-test-*/**', '**/dist/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
