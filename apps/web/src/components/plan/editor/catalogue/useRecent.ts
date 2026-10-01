'use client';

import { useState } from 'react';

/*
 * Two per-viewer conveniences, kept in this browser only: the rail category last open, and the last
 * few things placed. Both are wrapped in try/catch — storage can be absent, blocked or full, and a
 * sidebar that failed to draw because it could not remember a tab would be a poor trade.
 */

const RECENT_KEY = 'garden-studio.catalogue.recent';
const CATEGORY_KEY = 'garden-studio.catalogue.category';
const RECENT_LIMIT = 8;

function read(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* A convenience, never a failure. */
  }
}

/** The ids of the last things armed, most recent first. */
export function useRecent(): { recent: string[]; remember: (id: string) => void } {
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(read(RECENT_KEY) ?? '[]') as unknown;
      return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });

  const remember = (id: string) => {
    setRecent((current) => {
      const next = [id, ...current.filter((other) => other !== id)].slice(0, RECENT_LIMIT);
      write(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  };

  return { recent, remember };
}

/** The rail category, remembered, falling back to the first when nothing (valid) was stored. */
export function useStoredChoice<T extends string>(allowed: readonly T[], fallback: T): [T, (next: T) => void] {
  const [choice, setChoice] = useState<T>(() => {
    const stored = read(CATEGORY_KEY);
    return stored && (allowed as readonly string[]).includes(stored) ? (stored as T) : fallback;
  });
  const choose = (next: T) => {
    setChoice(next);
    write(CATEGORY_KEY, next);
  };
  return [choice, choose];
}
