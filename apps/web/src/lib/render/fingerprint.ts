import { hashString } from '@garden-studio/schema';

/** Stable render dependency hash. Object insertion order must not change the picture. */
export function fingerprint(value: unknown): string {
  return hashString(JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  })).toString(36);
}
