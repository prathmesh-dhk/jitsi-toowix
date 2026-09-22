import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// This site previously served the stock Jitsi web client under /meet. That client
// registered pwa-worker.js at the meeting-path scope. The React client is not a PWA;
// leaving that old worker active can make iPhone Safari serve its stale/offline response
// instead of a newly opened meeting link. Remove only that legacy worker on this origin.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map(async (registration) => {
      const scriptUrls = [ registration.active, registration.installing, registration.waiting ]
        .map((worker) => worker?.scriptURL || '');
      const isLegacyJitsiWorker = scriptUrls.some((url) => url.includes('/pwa-worker.js'));

      if (isLegacyJitsiWorker) {
        await registration.unregister();
        try {
          await caches.delete('offline');
        } catch {
          // Cache Storage is unavailable in some private browser contexts.
        }
      }
    })))
    .catch(() => {
      // A blocked service-worker API must not prevent the meeting app from loading.
    });
}

// ============================================================================
// SECURITY LAYER: MASK JWT TOKENS & SENSITIVE CREDENTIALS IN CONSOLE
// ============================================================================
const JWT_PATTERN = /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g;

function sanitizeLogArg(arg: any): any {
  if (typeof arg === 'string') {
    return arg.replace(JWT_PATTERN, '[SECURE_TOKEN_REDACTED]');
  }
  if (arg && typeof arg === 'object') {
    try {
      const copy = Array.isArray(arg) ? [...arg] : { ...arg };
      for (const key of Object.keys(copy)) {
        if (/token|jwt|passcode|password|authorization/i.test(key) && typeof copy[key] === 'string') {
          copy[key] = '[SECURE_REDACTED]';
        } else if (typeof copy[key] === 'object' && copy[key] !== null) {
          copy[key] = sanitizeLogArg(copy[key]);
        }
      }
      return copy;
    } catch {
      return arg;
    }
  }
  return arg;
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const originalDebug = console.debug;

console.log = (...args: any[]) => originalLog(...args.map(sanitizeLogArg));
console.warn = (...args: any[]) => originalWarn(...args.map(sanitizeLogArg));
console.error = (...args: any[]) => originalError(...args.map(sanitizeLogArg));
console.debug = (...args: any[]) => originalDebug(...args.map(sanitizeLogArg));

if (import.meta.env.PROD) {
  console.debug = () => {};
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

