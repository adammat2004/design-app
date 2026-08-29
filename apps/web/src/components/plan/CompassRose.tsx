/**
 * North is up. Coordinates are a local planar system rather than geographic data, so this is
 * an orientation cue for the person reading the plan, not a projection.
 */
export function CompassRose() {
  return (
    <div
      data-testid="compass"
      aria-label="North is up"
      role="img"
      className="pointer-events-none absolute bottom-16 left-4 flex h-12 w-12 items-center justify-center rounded-full border border-garden-line bg-white/90 shadow-sm"
    >
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
        <path d="M12 3 L16 19 L12 15.5 L8 19 Z" className="fill-garden-forest" />
        <path d="M12 3 L16 19 L12 15.5 Z" className="fill-garden-muted" />
      </svg>
      <span className="absolute top-0.5 text-[8px] font-semibold text-garden-forest">N</span>
    </div>
  );
}
