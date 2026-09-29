// Standalone Vite config for the bench harness ONLY -- deliberately separate from the app's own
// vite.config.ts/package.json (never touched). Serves bench/harness/, which imports the real,
// unmodified virtual-background source from ../src/lib/virtualBackground/.
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'bench/harness',
  server: {
    port: 5199,
    strictPort: true,
    fs: {
      // Needs to read ../../src (real source) and ../../public (real self-hosted wasm/model
      // files at /libs/...) from outside the harness's own root.
      allow: [ '..', '../..' ]
    }
  },
  // Serves the app's REAL public/ folder (the self-hosted MediaPipe wasm + model files under
  // /libs/, already required to exist there for production) -- read-only, nothing added/changed.
  publicDir: '../../public'
});
