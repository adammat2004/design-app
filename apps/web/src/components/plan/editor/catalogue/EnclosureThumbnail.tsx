'use client';

import type { EnclosureKind } from '@garden-studio/schema';

/** A short run of the kind, drawn as the plan draws it: a band with its posts, piers or crowns. */
export function EnclosureThumbnail({ kind }: { kind: EnclosureKind }) {
  const colour: Record<EnclosureKind, { body: string; detail: string | null; gap: number; thick: number; dash?: boolean }> = {
    fence: { body: '#9a8460', detail: '#7a6747', gap: 18, thick: 5 },
    screen: { body: '#8a6a4c', detail: '#6b5038', gap: 24, thick: 4 },
    wall: { body: '#9a8f81', detail: '#847a6d', gap: 24, thick: 9 },
    hedge: { body: '#385a31', detail: '#47703e', gap: 8, thick: 16 },
    railing: { body: '#5c6168', detail: '#484d53', gap: 5, thick: 2 },
    kerb: { body: '#b8b4ab', detail: null, gap: 0, thick: 6 },
    open: { body: '#8a938c', detail: null, gap: 0, thick: 1.5, dash: true },
  };
  const spec = colour[kind];
  const posts = spec.detail && spec.gap > 0 ? Array.from({ length: Math.floor(80 / spec.gap) + 1 }, (_, i) => 8 + i * spec.gap) : [];
  return (
    <svg viewBox="0 0 96 64" aria-hidden className="h-full w-full">
      <rect x="0" y="0" width="96" height="64" fill="#e3ead9" />
      {spec.dash ? (
        <line x1="8" y1="32" x2="88" y2="32" stroke={spec.body} strokeWidth={spec.thick} strokeDasharray="5 4" />
      ) : (
        <rect x="8" y={32 - spec.thick / 2} width="80" height={spec.thick} fill={spec.body} rx={kind === 'hedge' ? spec.thick / 2 : 0} />
      )}
      {posts.map((x) =>
        kind === 'hedge' ? (
          <circle key={x} cx={x} cy={32} r={5} fill={spec.detail!} opacity={0.8} />
        ) : (
          <rect key={x} x={x - 1.5} y={32 - spec.thick / 2 - 1} width={3} height={spec.thick + 2} fill={spec.detail!} />
        ),
      )}
    </svg>
  );
}
