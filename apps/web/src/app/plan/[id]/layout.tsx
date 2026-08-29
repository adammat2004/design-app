import { notFound } from 'next/navigation';
import { ProjectHydrator } from '@/components/plan/ProjectHydrator';
import { getProject } from '@/lib/plan-api';

/**
 * Fetches the plan on the server and hands it to the client hydrator.
 *
 * Server-side so the first paint already has the garden in it, rather than the canvas appearing
 * empty and filling in once a client fetch resolves.
 */
export default async function PlanProjectLayout({ children, params }: LayoutProps<'/plan/[id]'>) {
  const { id } = await params;

  const project = await getProject(id).catch(() => null);
  if (!project) notFound();

  return <ProjectHydrator project={project}>{children}</ProjectHydrator>;
}
