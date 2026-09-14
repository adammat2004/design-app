import { notFound } from 'next/navigation';
import { RenderLab } from '@/components/plan/editor/RenderLab';

/** Local visual QA has no access to a user's project and is unavailable in production. */
export default function RenderLabPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <RenderLab />;
}
