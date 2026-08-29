'use client';

import { useEffect, useState } from 'react';

/** How often the label is allowed to go stale, in milliseconds. */
const TICK = 30_000;

/**
 * "just now" / "2 min ago" / "3 hours ago", re-rendering on its own so the label does not sit
 * frozen at whatever it said when the component last happened to update.
 *
 * The clock is held in state rather than read during render: `Date.now()` in a render body
 * makes the component impure, and the label would then change on any unrelated re-render.
 */
export function useRelativeTime(timestamp: number): string {
  const [now, setNow] = useState(timestamp);

  useEffect(() => {
    // A zero-delay timeout rather than a straight setState, so the correction happens in a
    // callback instead of synchronously inside the effect body.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), TICK);

    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);

  return formatRelativeTime(timestamp, Math.max(now, timestamp));
}

export function formatRelativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));

  if (seconds < 45) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
