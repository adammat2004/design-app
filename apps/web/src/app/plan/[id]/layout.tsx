import { notFound } from 'next/navigation';
import { ApiUnreachable } from '@/components/plan/ApiUnreachable';
import { ProjectHydrator } from '@/components/plan/ProjectHydrator';
import { API_URL, ApiError, getProject } from '@/lib/plan-api';

/**
 * Fetches the plan on the server and hands it to the client hydrator.
 *
 * Server-side so the first paint already has the garden in it, rather than the canvas appearing
 * empty and filling in once a client fetch resolves.
 *
 * **Three failures, three answers.** This used to be `getProject(id).catch(() => null)` followed by
 * `notFound()`, which told someone whose API was simply not running that their URL was wrong — a
 * silent failure of exactly the kind that wastes an hour. The three cases are genuinely different
 * and the user can act on two of them:
 *
 * ```
 *   404 from the API      ─▶ notFound()        this plan does not exist
 *   cannot reach the API  ─▶ ApiUnreachable    the server is not running; here is how to start it
 *   anything else         ─▶ rethrow           error.tsx, because we do not know what happened
 * ```
 *
 * The middle case is handled *here* rather than in `error.tsx` on purpose: Next scrubs server-side
 * error messages in production and gives the boundary only a digest, so by the time an error page
 * sees it, what went wrong is no longer knowable. It is knowable at this line.
 */
export default async function PlanProjectLayout({ children, params }: LayoutProps<'/plan/[id]'>) {
  const { id } = await params;

  const result = await loadProject(id);

  if (result.status === 'missing') notFound();
  if (result.status === 'unreachable') return <ApiUnreachable apiUrl={API_URL} />;

  return <ProjectHydrator project={result.project}>{children}</ProjectHydrator>;
}

type LoadResult =
  | { status: 'ok'; project: Awaited<ReturnType<typeof getProject>> }
  | { status: 'missing' }
  | { status: 'unreachable' };

async function loadProject(id: string): Promise<LoadResult> {
  try {
    return { status: 'ok', project: await getProject(id) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { status: 'missing' };
    if (isUnreachable(error)) return { status: 'unreachable' };

    // Genuinely unexpected. Let it reach the error boundary rather than dressing it up as one of
    // the two cases above — a wrong explanation is worse than an honest "something went wrong".
    throw error;
  }
}

/**
 * Whether this failure means "the server is not answering" rather than "the server said no".
 *
 * A dead connection surfaces as a `TypeError` from `fetch` with a cause attached, not as a status,
 * because there was never a response to read one from. A 5xx is grouped with it deliberately: from
 * the user's side "the API is broken" and "the API is absent" have the same fix and the same next
 * action, and offering to start it costs nothing if it is already running.
 */
function isUnreachable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500;

  return error instanceof TypeError;
}
