'use client';

/**
 * The boundary for failures in the root layout itself.
 *
 * `error.tsx` sits *inside* the root layout, so it cannot catch a throw from the layout that
 * renders it. This one replaces the whole document, which is why it has to bring its own `<html>`
 * and `<body>` — nothing above it survives to provide them.
 *
 * Deliberately plain, and the docs confirm this is required rather than cautious: `global-error`
 * renders its own document and does **not** include your global styles, so any Tailwind class here
 * would do nothing. The styles are inline so this screen looks intentional even though the app's
 * CSS never arrives.
 *
 * `retry()` rather than `reset()` — see `error.tsx`.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en-GB">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f4f2ed',
          color: '#1a231c',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <div data-testid="global-error" style={{ maxWidth: '26rem', padding: '2rem' }}>
          <h1 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Garden Studio could not start</h1>
          <p style={{ fontSize: '0.8rem', lineHeight: 1.6, color: '#5b6b5e' }}>
            Something failed before the app could draw anything. Any plan you have made is stored on
            the server and is not affected.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: '0.5rem',
              borderRadius: '999px',
              border: 0,
              background: '#2f4034',
              color: 'white',
              padding: '0.5rem 1.25rem',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ marginTop: '0.75rem', fontSize: '0.65rem', color: '#5b6b5e' }}>
              Reference <code>{error.digest}</code>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
