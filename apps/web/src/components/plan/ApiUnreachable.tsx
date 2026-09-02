import { PlugZap } from 'lucide-react';

/**
 * What to show when the API is not answering.
 *
 * This exists because the alternative was actively misleading. The plan layout used to do
 * `getProject(id).catch(() => null)` and then `notFound()`, which collapsed three different
 * situations — a plan that does not exist, a server that is not running, and a server that
 * errored — into one screen reading "This page could not be found". Someone who had simply not
 * started the API was told their URL was wrong.
 *
 * **The copy has to live here rather than in `error.tsx`.** Next.js scrubs server-side error
 * messages in production builds and hands the boundary only a `digest`, so an error page cannot
 * know what went wrong. The layout still can, because it caught the failure itself.
 *
 * Deliberately says the address it tried and the command that fixes it. The single likeliest
 * reader of this screen is someone running the project for the first time from the README.
 */
export function ApiUnreachable({ apiUrl }: { apiUrl: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-garden-canvas p-6 text-center">
      <div
        data-testid="api-unreachable"
        className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-garden-line bg-white p-10 shadow-sm"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-garden-sage">
          <PlugZap aria-hidden className="h-6 w-6 text-garden-green" />
        </span>

        <h1 className="text-sm font-semibold text-garden-forest">Cannot reach the API</h1>

        <p className="text-xs leading-relaxed text-garden-muted">
          Your plan is safe. The app could not reach the server at{' '}
          <code className="rounded bg-garden-canvas px-1 py-0.5 text-[11px] text-garden-ink">
            {apiUrl}
          </code>
          , so it has nothing to load.
        </p>

        <div className="mt-1 w-full rounded-lg bg-garden-canvas p-3 text-left">
          <p className="text-[11px] font-semibold text-garden-forest">
            Most likely it is not running
          </p>
          <pre className="mt-1.5 overflow-x-auto text-[11px] leading-relaxed text-garden-muted">
            <code>{'docker compose up -d\npnpm dev'}</code>
          </pre>
        </div>

        <p className="text-[11px] text-garden-muted">
          Reload this page once it is up. Nothing has been lost.
        </p>
      </div>
    </div>
  );
}
