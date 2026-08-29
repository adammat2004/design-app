import Link from 'next/link';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { PlanTopBar } from '@/components/plan/PlanTopBar';

/**
 * Step 6 does not exist yet. This is a signpost, not the screen — it keeps the wizard walkable
 * end to end instead of dropping an edited plan onto a 404, and it is what the step indicator's
 * sixth entry points at.
 */
export default async function ReviewPage({ params }: PageProps<'/plan/[id]/review'>) {
  const { id } = await params;

  return (
    <div className="flex min-h-dvh flex-col">
      <PlanTopBar currentStep={6} />

      <main className="flex flex-1 items-center justify-center p-6">
        <div
          data-testid="review-placeholder"
          className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-garden-line bg-white p-10 text-center shadow-sm"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-garden-sage">
            <ClipboardCheck aria-hidden className="h-6 w-6 text-garden-green" />
          </span>
          <h1 className="text-sm font-semibold text-garden-forest">Review is coming</h1>
          <p className="text-xs leading-relaxed text-garden-muted">
            Your plan is saved. Costing it, listing its planting and letting you sign it off is the
            next piece of work.
          </p>
          <Link
            href={`/plan/${id}/editor`}
            data-testid="back-to-editor"
            className="mt-1 flex items-center gap-2 rounded-full bg-garden-forest px-5 py-2 text-sm font-semibold text-white hover:bg-garden-green"
          >
            <ArrowLeft aria-hidden className="h-4 w-4" />
            Back to the editor
          </Link>
        </div>
      </main>
    </div>
  );
}
