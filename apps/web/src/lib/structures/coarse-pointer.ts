'use client';

import { useSyncExternalStore } from 'react';

/*
 * Whether the pointer is a finger. A finger has one gesture and the orbit already has it, so the 3D
 * views drop what would compete with it — the resize handles, the post pass — on a coarse pointer.
 * Shared by the structure editor and the garden preview so they cannot answer differently.
 */
const COARSE = '(pointer: coarse)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia?.(COARSE);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}
const now = () => window.matchMedia?.(COARSE).matches ?? false;
const onServer = () => false;

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, now, onServer);
}
