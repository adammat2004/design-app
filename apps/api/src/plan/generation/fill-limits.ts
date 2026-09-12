/**
 * The smallest fill PostGIS will keep, shared by the query that enforces it and the sketch that
 * must respect it.
 *
 * A leaf module on purpose. `fill.service.ts` imports the database driver, and the templates in
 * `layout/` are pure functions a test runs without one — so the constant they both need lives
 * here rather than in either. A bed sketched thinner than `MIN_FILL_SIDE` is not drawn thin; it
 * is silently thrown away by the sliver guard, which is how a small garden came out with a lawn,
 * a patio and nothing else.
 */

/** A remainder region under this many square metres is a sliver, not a bed. */
export const MIN_FILL_AREA = 1.2;

/** A region narrower than this anywhere is rejected: it would draw as a line, not a surface. */
export const MIN_FILL_SIDE = 1.2;
