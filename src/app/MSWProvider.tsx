'use client';

/**
 * src/app/MSWProvider.tsx
 *
 * Conditionally initialises the MSW browser service worker in non-production
 * environments. In production this component renders its children unchanged.
 *
 * Design decisions:
 * - Dynamic import inside useEffect ensures the MSW bundle is never included
 *   in the production JS output (tree-shaken at build time when the branch is
 *   unreachable).
 * - onUnhandledRequest: 'bypass' lets unregistered routes reach the real
 *   Next.js API handlers so normal development works without any mock active.
 * - mountMSW() exposes window.__msw after the worker starts so Playwright
 *   tests can call window.__msw.use(key) to activate handlers by name.
 */

import { useEffect, useRef } from 'react';

export function MSWProvider({ children }: { children: React.ReactNode }) {
  // Store the worker instance so cleanup can call worker.stop() to
  // deregister the service worker when the component unmounts.
  const workerRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    // Guard: never load the service worker in production. The dynamic import
    // below is still present in the production bundle unless this guard is here
    // because Next.js evaluates the module at build time.
    if (process.env.NODE_ENV === 'production') return;

    // Cancelled flag prevents double-start under React Strict Mode, which
    // fires effects twice in dev to surface missing cleanup.
    let cancelled = false;
    void (async () => {
      const { worker, mountMSW } = await import('../mocks/browser');
      if (cancelled) return;
      await worker.start({
        // bypass: let requests without an active handler reach the real
        // Next.js API routes. This means `pnpm dev` works normally when no
        // Playwright test has called window.__msw.use().
        onUnhandledRequest: 'bypass',
        serviceWorker: { url: '/mockServiceWorker.js' },
      });
      if (cancelled) return;
      workerRef.current = worker;
      // Expose the string-keyed bridge for Playwright test coordination.
      mountMSW(worker);
    })();
    return () => {
      cancelled = true;
      workerRef.current?.stop();
      workerRef.current = null;
    };
  }, []);

  // React 19: components can return children directly — no Fragment needed.
  return children;
}
