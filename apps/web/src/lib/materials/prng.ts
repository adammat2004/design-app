/**
 * Seeded randomness, re-exported.
 *
 * This lived here because only the renderer needed it. It moved to `packages/schema` when the
 * generator started placing structural plants: both sides have to draw the *same* numbers from the
 * *same* seed, or a shrub the server places and a shrub the painter would have drawn land in
 * different spots — and the whole point of lifting structural planting out of the texture is that
 * they are the same plant.
 *
 * Re-exported rather than moved outright so the fifteen call sites in this directory are unchanged
 * and the renderer keeps reading as though the primitive is local, which for its purposes it is.
 */
export { hashString, mulberry32, moduleRandom, pick } from '@garden-studio/schema';
