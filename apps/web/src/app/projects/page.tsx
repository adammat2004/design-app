import Link from 'next/link';
import { ArrowRight, Plus, Sprout } from 'lucide-react';
import { ApiUnreachable } from '@/components/plan/ApiUnreachable';
import { API_URL, listProjects } from '@/lib/plan-api';

/**
 * Every plan you have made.
 *
 * This is the screen that makes persistence real. The API has had `GET /plan-projects` since the
 * beginning and `listProjects()` has been sitting in `plan-api.ts` with **zero callers** — so
 * plans were being saved faithfully and there was no way back to one. Close the tab without
 * bookmarking the URL and a finished garden was gone, while the README claimed "it is all still
 * there tomorrow".
 *
 * Server-rendered, so the list is in the first paint rather than appearing a moment later. There
 * is no auth, so this is every plan on the machine — which is exactly right for a single-user tool
 * and would need rethinking the moment it were not one.
 */
export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const result = await loadProjects();

  if (result.status === 'unreachable') return <ApiUnreachable apiUrl={API_URL} />;

  const { projects } = result;

  return (
    <div className="flex min-h-dvh flex-col bg-garden-canvas">
      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <header className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-garden-sage">
              <Sprout aria-hidden className="h-5 w-5 text-garden-green" />
            </span>
            <div>
              <h1 className="text-base font-semibold text-garden-forest">Your plans</h1>
              <p className="text-xs text-garden-muted">
                {projects.length === 0
                  ? 'Nothing saved yet'
                  : `${projects.length} saved on this machine`}
              </p>
            </div>
          </div>

          <Link
            href="/plan"
            data-testid="new-plan"
            className="flex shrink-0 items-center gap-2 rounded-full bg-garden-forest px-4 py-2 text-sm font-semibold text-white hover:bg-garden-green"
          >
            <Plus aria-hidden className="h-4 w-4" />
            New plan
          </Link>
        </header>

        {projects.length === 0 ? (
          <p
            data-testid="projects-empty"
            className="rounded-xl border border-garden-line bg-white p-10 text-center text-xs leading-relaxed text-garden-muted shadow-sm"
          >
            Plans you start are saved automatically and will appear here. Nothing is ever lost by
            closing the tab.
          </p>
        ) : (
          <ul data-testid="projects-list" className="space-y-2">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/plan/${project.id}/map`}
                  data-testid={`project-${project.id}`}
                  className="flex items-center justify-between gap-4 rounded-xl border border-garden-line bg-white px-4 py-3 shadow-sm transition-colors hover:border-garden-green"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-garden-ink">
                      {project.name}
                    </span>
                    <span className="block text-[11px] text-garden-muted">
                      Last saved {formatSaved(project.updatedAt)}
                    </span>
                  </span>
                  <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-garden-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

type LoadResult =
  { status: 'ok'; projects: Awaited<ReturnType<typeof listProjects>> } | { status: 'unreachable' };

async function loadProjects(): Promise<LoadResult> {
  try {
    return { status: 'ok', projects: await listProjects() };
  } catch (error) {
    // Same rule as the plan layout: a server that is not answering gets the screen that says so
    // and how to start it. Anything else is genuinely unexpected and belongs to the boundary.
    if (error instanceof TypeError) return { status: 'unreachable' };
    throw error;
  }
}

/**
 * An absolute date, not "3 days ago".
 *
 * The wizard's bottom bar already says "saved just now" while you work, because there the question
 * is whether the last keystroke landed. Here the question is which of several gardens this is, and
 * a date answers that where a relative time does not — two plans both reading "last month" tells
 * you nothing about which is which.
 */
function formatSaved(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return 'recently';

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
