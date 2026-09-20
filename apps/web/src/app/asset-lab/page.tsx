import { notFound } from 'next/navigation';
import { AssetLab } from '@/components/plan/editor/AssetLab';

/**
 * The asset comparison lab: every family in the library, in the context it is drawn in.
 *
 * Development only, like `/render-lab`. It reads the catalogue and the files under `public/assets/`
 * and, for old-against-new comparison, the gitignored `public/assets-v1/` snapshot; a production
 * build has no business serving either as a page.
 */
export default function AssetLabPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <AssetLab />;
}
