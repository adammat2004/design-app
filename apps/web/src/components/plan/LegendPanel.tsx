export type SwatchKind = 'boundary' | 'house' | 'garden' | 'measurement' | 'alignment' | 'corner';

const ENTRIES: { label: string; kind: SwatchKind }[] = [
  { label: 'Property boundary', kind: 'boundary' },
  { label: 'House footprint', kind: 'house' },
  { label: 'Usable outdoor area', kind: 'garden' },
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
