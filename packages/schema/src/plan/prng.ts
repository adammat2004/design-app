/**
 * Seeded randomness for the pattern renderer.
 *
 * `Math.random()` is not usable here, and the reason is worth stating plainly: the raster for a
 * surface is thrown away and regenerated every time the zoom crosses a bucket boundary. If the
 * tone of a slab were drawn from a global generator it would come back different each time, and
 * the whole plan would shimmer as the user zoomed — the paving equivalent of texture crawl.
 *
 * So every random number is a pure function of things that do not change: the surface's seed and
 * the module's own grid coordinates.
 */

/** FNV-1a. Small, fast, and good enough to decorrelate the short ids this is fed. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // The FNV prime, 16777619, by shift-and-add — `hash * 16777619` overflows a double's
    // integer range and starts losing low bits, which is where the collisions come from.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }

  return hash >>> 0;
}

/** mulberry32: one 32-bit word of state, uniform enough for tone selection and jitter. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mixes two signed integers into a hash. Signed on purpose — grid coordinates go negative the
 * moment a surface sits up-left of the pattern origin, which for a plan anchored at `{0,0}` is
 * never, and for a re-anchored one is routine.
 */
function mixCoordinates(seed: number, col: number, row: number): number {
  let hash = seed >>> 0;

  hash = Math.imul(hash ^ (col | 0), 0x27d4eb2d) >>> 0;
  hash = Math.imul(hash ^ (row | 0), 0x165667b1) >>> 0;
  hash ^= hash >>> 15;

  return hash >>> 0;
}

/**
 * The generator for one module.
 *
 * The module's coordinates go into the *seed*, not into the sequence. That distinction is the
 * whole point: a generator advanced once per module as the renderer sweeps the grid would give
 * every slab a tone that depended on how many slabs came before it, so clipping the surface
 * differently — dragging one vertex — would renumber the sweep and repaint the entire polygon.
 * Keying on `(seed, col, row)` means a slab's tone depends on nothing but where it is.
 */
export function moduleRandom(seed: string, col: number, row: number): () => number {
  return mulberry32(mixCoordinates(hashString(seed), col, row));
}

/** Picks an item by a value already drawn from a generator. Empty input is a programming error. */
export function pick<T>(items: readonly T[], unitInterval: number): T {
  if (items.length === 0) throw new Error('pick called with no items');

  const index = Math.min(items.length - 1, Math.floor(unitInterval * items.length));

  return items[index]!;
}
