export type SwatchKind =
  | 'boundary'
  | 'house'
  | 'garden'
  | 'measurement'
  | 'alignment'
  | 'corner'
  | 'gate'
  | 'driveway'
  | 'window';

const ENTRIES: { label: string; kind: SwatchKind }[] = [
  { label: 'Property boundary', kind: 'boundary' },
  { label: 'House footprint', kind: 'house' },
  { label: 'Usable outdoor area', kind: 'garden' },
  /*
   * The marks a reader would otherwise have to guess at. A gap in the boundary is now three
   * different things depending on what is hung in it, and a window is deliberately *not* drawn as
   * a gap — so the legend has to say which is which or the distinction is only in the code.
   */
  { label: 'Gate', kind: 'gate' },
  { label: 'Driveway or open gap', kind: 'driveway' },
  { label: 'Door or window', kind: 'window' },
  { label: 'Measurement guide', kind: 'measurement' },
  { label: 'Alignment guide', kind: 'alignment' },
  { label: 'Corner point', kind: 'corner' },
];

export function LegendPanel() {
  return (
    <section className="rounded-xl border border-garden-line bg-white p-4 shadow-sm">
      <h2 className="text-xs font-semibold text-garden-ink">Legend</h2>

      <ul className="mt-3 space-y-2">
        {ENTRIES.map((entry) => (
          <li key={entry.label} className="flex items-center gap-2.5">
            <LegendSwatch kind={entry.kind} />
            <span className="text-[11px] text-garden-muted">{entry.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Shared with the Mapping summary so both panels use one visual vocabulary. Every swatch
 * occupies the same 24px slot, so the labels line up whatever the shape.
 */
export function LegendSwatch({ kind }: { kind: SwatchKind }) {
  if (kind === 'boundary') {
    return (
      <span aria-hidden className="flex w-6 shrink-0 justify-center">
        <span className="h-0.5 w-6 rounded-full bg-garden-green" />
      </span>
    );
  }

  if (kind === 'measurement' || kind === 'alignment') {
    return (
      <span aria-hidden className="flex w-6 shrink-0 justify-center">
        {/* Long dashes measure a distance; fine dots mark an alignment. */}
        <svg viewBox="0 0 24 2" className="h-0.5 w-6 overflow-visible">
          <line
            x1="0"
            y1="1"
            x2="24"
            y2="1"
            strokeWidth="1.5"
            strokeDasharray={kind === 'measurement' ? '5 3' : '1.5 2.5'}
            className={kind === 'measurement' ? 'stroke-garden-muted' : 'stroke-garden-green'}
          />
        </svg>
      </span>
    );
  }

  /*
   * Drawn rather than coloured: these three differ in *shape*, which is the whole point of them,
   * so a square of colour would say nothing. Each is the mark itself at legend size.
   */
  if (kind === 'gate' || kind === 'driveway') {
    return (
      <span aria-hidden className="flex w-6 shrink-0 justify-center">
        <svg viewBox="0 0 24 10" className="h-2.5 w-6 overflow-visible">
          {/* The boundary, broken for the opening. */}
          <line x1="0" y1="8" x2="8" y2="8" strokeWidth="1.5" className="stroke-garden-green" />
          <line x1="16" y1="8" x2="24" y2="8" strokeWidth="1.5" className="stroke-garden-green" />
          {kind === 'gate' ? (
            <line x1="8" y1="8" x2="8" y2="1" strokeWidth="1.5" className="stroke-amber-700" />
          ) : (
            <>
              {/* A pair of leaves hung at opposite ends: the double-gate convention. */}
              <line x1="8" y1="8" x2="10" y2="2" strokeWidth="1.5" className="stroke-amber-700" />
              <line x1="16" y1="8" x2="14" y2="2" strokeWidth="1.5" className="stroke-amber-700" />
            </>
          )}
        </svg>
      </span>
    );
  }

  if (kind === 'window') {
    return (
      <span aria-hidden className="flex w-6 shrink-0 justify-center">
        <svg viewBox="0 0 24 10" className="h-2.5 w-6 overflow-visible">
          {/* The wall band, with the opening drawn across it. */}
          <rect x="0" y="3" width="24" height="4" className="fill-slate-400" />
          <line x1="8" y1="3" x2="16" y2="3" strokeWidth="2" className="stroke-garden-forest" />
          <line x1="8" y1="7" x2="16" y2="7" strokeWidth="1.5" className="stroke-garden-forest" />
        </svg>
      </span>
    );
  }

  if (kind === 'corner') {
    return (
      <span
        aria-hidden
        className="flex h-4 w-6 shrink-0 items-center justify-center text-[8px] font-semibold"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-garden-green text-white">
          A
        </span>
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={[
        'h-4 w-6 shrink-0 rounded border',
        kind === 'house'
          ? 'border-slate-400 bg-slate-200'
          : 'border-garden-green/40 bg-garden-sage',
      ].join(' ')}
    />
  );
}
