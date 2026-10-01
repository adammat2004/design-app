import { notFound } from 'next/navigation';
import { ModelLab } from '@/components/model-lab/ModelLab';

/**
 * The model lab: asking Meshy for a library model, watching it being made, and publishing it.
 *
 * Development only, like `/asset-lab`. It spends real credits through the API, which refuses in
 * production on its own account; a production build has no business serving the page either.
 */
export default function ModelLabPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <ModelLab />;
}
