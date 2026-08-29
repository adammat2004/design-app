'use client';

/**
 * The canvas toolbar's building blocks, shared by the boundary editor and the existing-features
 * editor so the two toolbars stay one control surface rather than two lookalikes.
 */

export function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-garden-line bg-white p-1 shadow-sm">
      {children}
    </div>
  );
}

export function ToolbarButton({
  testId,
  label,
  hint,
  icon,
  pressed,
  disabled,
  title,
  onClick,
}: {
  testId: string;
  label: string;
  /** Small second line, e.g. the "(locked)" on step 2's Boundary and House buttons. */
  hint?: string;
  icon: React.ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
        'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-40',
        pressed
          ? 'bg-garden-sage text-garden-forest'
          : 'text-garden-muted enabled:hover:bg-garden-sage enabled:hover:text-garden-forest',
      ].join(' ')}
    >
      {icon}
      {hint ? (
        <span className="flex flex-col items-start leading-tight">
          <span>{label}</span>
          <span className="text-[9px] font-normal opacity-70">{hint}</span>
        </span>
      ) : (
        label
      )}
    </button>
  );
}
