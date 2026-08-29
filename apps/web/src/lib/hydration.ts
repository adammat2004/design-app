/**
 * Loading a stored plan has to put the id counters back where they were.
 *
 * Every store mints ids from a module-level counter (`v1`, `f1`, `e-1`). Those counters start at
 * zero on a fresh page, so a plan hydrated with `f7` in it would mint `f1` for the next feature
 * and collide with something already on the plan. Re-seeding from the highest id actually present
 * is the fix.
 */
export function highestId(ids: string[], pattern: RegExp): number {
  return ids.reduce((max, id) => {
    const match = pattern.exec(id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}
