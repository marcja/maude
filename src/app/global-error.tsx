'use client';

/**
 * src/app/global-error.tsx
 *
 * Next.js global error boundary — replaces the root layout when an uncaught
 * error occurs. Must define its own <html>/<body> because the root layout is
 * not rendered. Kept minimal: no context providers, no external styles.
 *
 * Without this file, Next.js generates a default global-error page that fails
 * to prerender because our root layout's client providers (ObservabilityProvider,
 * MSWProvider) use hooks that aren't available during static generation.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body style={{ backgroundColor: '#15161e', color: '#e4e4ec', fontFamily: 'sans-serif' }}>
        <div style={{ padding: '2rem', textAlign: 'center', marginTop: '4rem' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#9394a5', marginTop: '0.5rem' }}>
            {error.digest ? `Error ID: ${error.digest}` : error.message}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              padding: '0.5rem 1.5rem',
              backgroundColor: '#c4916e',
              color: '#15161e',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
