'use client';

import { useEffect, useState } from 'react';
import { patternCacheStats } from '@/lib/materials/pattern-cache';
import { shadowCacheStats } from '@/lib/materials/shadow-cache';

/**
 * What the render layer is actually doing, while you tune it.
 *
 * The whole material pipeline is built around two caches, and until now their effectiveness was
 * visible to nobody: `patternCacheSize` and `patternCacheHas` existed but were marked "test seams"
 * and nothing surfaced them. A collapsed hit rate does not throw and does not warn — it just feels
 * slightly slow, on a development machine faster than the one this will be marked on.
 *
 * **Development only, and gated on `NODE_ENV` rather than on a store flag.** That is deliberate:
 * `gridVisible` is documented as having five edit points, and the one that bites is
 * `ephemeralState()`, shared by the test reset and the hydrator — miss it and the flag survives a
 * reload. Another toggle would mean another five, for something no user ever needs to see.
 *
 * A poll rather than a subscription, because the caches are plain modules with no change
 * notification and giving them one would be real machinery in the render path to serve a dev
 * overlay. Twice a second is far below anything that could perturb what it is measuring.
 */
export function RenderHud() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;

    const timer = setInterval(() => setTick((value) => value + 1), 500);
    return () => clearInterval(timer);
  }, []);

  if (process.env.NODE_ENV === 'production') return null;

  void tick;

  const patterns = patternCacheStats();
  const shadows = shadowCacheStats();

  return (
    <div
      data-testid="render-hud"
      aria-hidden
      className="pointer-events-none absolute right-2 top-2 rounded-md bg-black/70 px-2 py-1.5 font-mono text-[10px] leading-tight text-white/90"
    >
      <Row label="surfaces" stats={patterns} />
      <Row label="shadows" stats={shadows} />
    </div>
  );
}

function Row({
  label,
  stats,
}: {
  label: string;
  stats: { size: number; hits: number; misses: number; capacity: number };
}) {
  const total = stats.hits + stats.misses;
  /*
   * Misses are the number that matters, not hits. A high hit count only says the canvas re-rendered
   * a lot; a climbing miss count while you pan or select means something is in the key that should
   * not be, and every one of those is a raster redrawn for nothing.
   */
  const hitRate = total === 0 ? '—' : `${Math.round((stats.hits / total) * 100)}%`;

  return (
    <div className="flex gap-2 whitespace-nowrap">
      <span className="w-14 text-white/60">{label}</span>
      <span>
        {stats.size}/{stats.capacity}
      </span>
      <span className="text-white/60">hit</span>
      <span>{hitRate}</span>
      <span className="text-white/60">miss</span>
      <span>{stats.misses}</span>
    </div>
  );
}
