'use client';

import { useState } from 'react';
import type { SiteLocation } from '@garden-studio/schema';

/**
 * The browser's own idea of where it is, with every failure named.
 *
 * Shared by the sun panel and the aerial address search, which want the same thing for
 * different reasons: one to light the plan, the other to open the imagery somewhere near the
 * garden. Every error branch says what went wrong *and* what to do next, because the next move
 * is always available — the caller supplies it as `fallback`.
 */
export function useGeolocation(onLocated: (location: SiteLocation) => void, fallback: string) {
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const ask = () => {
    setProblem(null);

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setProblem(`This browser cannot share a location. ${fallback}`);
      return;
    }

    setAsking(true);
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setAsking(false);
        onLocated({ latitude: result.coords.latitude, longitude: result.coords.longitude });
      },
      (error) => {
        setAsking(false);
        setProblem(
          error.code === error.PERMISSION_DENIED
            ? `Location permission was refused. ${fallback}`
            : `Could not get a location just now. ${fallback}`,
        );
      },
      { timeout: 10_000 },
    );
  };

  return { ask, asking, problem, clearProblem: () => setProblem(null) };
}
