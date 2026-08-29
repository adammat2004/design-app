import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Garden Studio — plan your garden',
};

export default function PlanLayout({ children }: LayoutProps<'/plan'>) {
  /*
   * The wizard is a light utility UI and does not follow the root stylesheet's
   * prefers-color-scheme flip, so the background and text colour are pinned here.
   */
  return (
    <div className="flex min-h-full flex-1 flex-col bg-garden-canvas text-garden-ink">
      {children}
    </div>
  );
}
