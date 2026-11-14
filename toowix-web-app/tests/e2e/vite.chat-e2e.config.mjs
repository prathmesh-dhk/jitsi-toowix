// Vite config for the chat browser test ONLY (the app's own vite.config.ts is untouched). Serves
// tests/e2e/chat-harness.html and swaps the Firebase module for the test stub.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..', '..');
const stub = path.join(here, 'firebase-stub.ts');

export default (backendUrl) => ({
  root: here,
  configFile: false,
  logLevel: 'error',
  plugins: [
    react(),
    {
      name: 'chat-e2e-firebase-stub',
      enforce: 'pre',
      resolveId(source, importer) {
        // src/lib/directChat/api.ts is the only module in the chat graph that imports ../firebase.
        if (source === '../firebase' && importer && importer.replace(/\\/g, '/').includes('/src/lib/directChat/')) return stub;

        return null;
      },
    },
  ],
  define: { 'import.meta.env.VITE_BACKEND_URL': JSON.stringify(backendUrl), 'import.meta.env.VITE_API_URL': JSON.stringify(backendUrl) },
  server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [webRoot] } },
  optimizeDeps: { entries: [path.join(here, 'chat-harness.tsx')] },
});
