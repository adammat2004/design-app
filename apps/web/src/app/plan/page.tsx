import { redirect } from 'next/navigation';
import { createProject } from '@/lib/plan-api';

/**
 * `/plan` is not a screen: it starts a new plan and sends the user into it.
 *
 * Creating on GET is a deliberate simplification for a single-user tool — there is no auth to
 * hang a "your projects" screen off yet, and the landing page's one button means to start
 * planning. `force-dynamic` so the redirect is never cached into "always this project".
 */
export const dynamic = 'force-dynamic';

export default async function PlanIndexPage() {
  const project = await createProject();

  redirect(`/plan/${project.id}/map`);
}
