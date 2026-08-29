'use client';

import type { StyleDirection } from '@/lib/brief';

/**
 * Stand-in artwork for the style gallery.
 *
 * The mockup shows photographs; there are none in the repo and no remote-image config, so
 * these are abstract plan-view motifs drawn in the garden palette instead. They render
 * offline, on the server and under jsdom, and cost nothing to ship.
 *
 * Everything about a style that the rest of the screen needs lives in `STYLE_DIRECTIONS`;
 * this file only draws. When real photography arrives, `StyleGallery` swaps this one element
 * for an `<Image />` and nothing else moves.
 */

/** Plan-view, 4:3, so the four read as four gardens rather than four abstractions. */
const VIEW = { width: 120, height: 90 };

const GROUND = '#eef2ea';
const PAVING = '#dfe3dc';
const GRAVEL = '#e6e2d6';
const LAWN = '#cfe0c4';
const HEDGE = '#7ea36f';
const PLANTING = '#94b884';
const BLOOM = '#d98ea8';
const ACCENT = '#1b4332';

export function StyleThumbnail({ style }: { style: StyleDirection }) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
    >
      <rect width={VIEW.width} height={VIEW.height} fill={GROUND} />
      {MOTIFS[style]}
    </svg>
  );
}

/**
 * Keyed by every direction including 'other', so adding one to the union forces artwork for
 * it — 'other' never reaches the gallery, but leaving a hole here would be a trap.
 */
const MOTIFS: Record<StyleDirection, React.ReactNode> = {
  /* Large-format paving, one long bench of planting, hard right angles. */
  modern: (
    <>
      <rect x={0} y={0} width={120} height={44} fill={PAVING} />
      <rect x={8} y={7} width={30} height={14} fill="#ffffff" opacity={0.55} />
      <rect x={42} y={7} width={30} height={14} fill="#ffffff" opacity={0.35} />
      <rect x={76} y={7} width={30} height={14} fill="#ffffff" opacity={0.55} />
      <rect x={8} y={25} width={30} height={14} fill="#ffffff" opacity={0.35} />
      <rect x={42} y={25} width={30} height={14} fill="#ffffff" opacity={0.55} />
      <rect x={76} y={25} width={30} height={14} fill="#ffffff" opacity={0.35} />
      <rect x={0} y={48} width={120} height={18} fill={PLANTING} />
      <rect x={0} y={70} width={120} height={20} fill={LAWN} />
      <rect x={86} y={72} width={26} height={14} fill={ACCENT} opacity={0.55} />
    </>
  ),

  /* Loose, overflowing borders and a path that wanders. */
  cottage: (
    <>
      <path d="M0 90 C 34 66, 42 42, 34 0 L 58 0 C 66 42, 58 66, 26 90 Z" fill={GRAVEL} />
      <rect x={0} y={0} width={30} height={90} fill={PLANTING} opacity={0.5} />
      <rect x={62} y={0} width={58} height={90} fill={PLANTING} opacity={0.5} />
      <circle cx={10} cy={14} r={9} fill={HEDGE} />
      <circle cx={22} cy={34} r={7} fill={BLOOM} />
      <circle cx={9} cy={52} r={8} fill={PLANTING} />
      <circle cx={20} cy={72} r={6} fill={BLOOM} />
      <circle cx={76} cy={12} r={8} fill={BLOOM} />
      <circle cx={98} cy={26} r={10} fill={HEDGE} />
      <circle cx={78} cy={46} r={7} fill={PLANTING} />
      <circle cx={104} cy={58} r={8} fill={BLOOM} />
      <circle cx={84} cy={76} r={9} fill={HEDGE} />
    </>
  ),

  /* Symmetry: a central axis, clipped blocks mirrored either side. */
  formal: (
    <>
      <rect x={50} y={0} width={20} height={90} fill={PAVING} />
      <rect x={0} y={0} width={50} height={90} fill={LAWN} />
      <rect x={70} y={0} width={50} height={90} fill={LAWN} />
      {[8, 34, 60].map((y) => (
        <g key={y}>
          <rect x={10} y={y} width={30} height={18} rx={2} fill={HEDGE} />
          <rect x={80} y={y} width={30} height={18} rx={2} fill={HEDGE} />
        </g>
      ))}
      <circle cx={60} cy={45} r={9} fill={ACCENT} opacity={0.55} />
    </>
  ),

  /* Mostly surface, planting kept to a few structural blocks. */
  lowMaintenance: (
    <>
      <rect x={0} y={0} width={120} height={30} fill={PAVING} />
      <rect x={0} y={34} width={120} height={22} fill={GRAVEL} />
      <rect x={0} y={60} width={120} height={30} fill={PAVING} />
      <rect x={12} y={38} width={22} height={14} rx={7} fill={PLANTING} />
      <rect x={48} y={38} width={22} height={14} rx={7} fill={HEDGE} />
      <rect x={84} y={38} width={22} height={14} rx={7} fill={PLANTING} />
      <circle cx={22} cy={14} r={7} fill={HEDGE} />
      <circle cx={98} cy={74} r={7} fill={HEDGE} />
    </>
  ),

  /* Never rendered — the "Other" card shows an icon, not artwork. */
  other: null,
};
