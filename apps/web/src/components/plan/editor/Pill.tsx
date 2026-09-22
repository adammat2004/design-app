'use client';

/**
 * The one small action control in the inspector.
 *
 * Five copies of this class used to live inline — the composer's chips, the run's Compare/Undo/
 * Replay, the at-work block's Stop, the reviewer's offers and the carried-over Undo — which is how
 * the property sheet and the designer came to be drawn in two shape languages. Every small action
 * on the subject is now the same pill, whether it edits a field, plays a run or sends a sentence:
 * the point of the inspector is that those are three ways of doing one thing.
 *
 * 32px tall with a 44px hit area through `before`, because these are reached for in a hurry — Stop
 * most of all — and a short pill is a miss on a trackpad and a certainty of one on a touch screen.
 */
export function Pill({
  children,
  onClick,
  testId,
  disabled = false,
  hint,
  icon,
  tone = 'default',
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  testId?: string;
  disabled?: boolean;
  /** Why it is disabled, as a tooltip. */
  hint?: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'danger';
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={hint}
      aria-label={ariaLabel}
      className={[
        "relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium whitespace-nowrap transition-colors before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[''] focus-visible:ring-2 focus-visible:ring-garden-ai focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
        tone === 'danger'
          ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
          : 'border-garden-line bg-white text-garden-ink hover:border-garden-green/60 hover:bg-garden-sage',
      ].join(' ')}
    >
      {icon}
      {children}
    </button>
  );
}

/** A section caption. One style for "Material", "Smart suggestions" and "Ask the designer" alike. */
export function Caption({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-[11px] font-medium text-garden-muted ${className}`.trim()}>{children}</p>
  );
}
