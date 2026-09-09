/**
 * The planting sampler, re-exported.
 *
 * It moved to `packages/schema` when the generator started placing structural plants as real
 * elements. Both sides must place them from the same function or a shrub the server positions and
 * the infill the painter draws around it disagree about where the plant is — which is the one thing
 * the sampler's spatial-hash determinism exists to prevent.
 *
 * That it moved at all is the plan working as intended: it was written as a pure function of
 * `(outline, layer, seed)` precisely so a future consumer could place real plants at exactly the
 * drawn positions, and this is that consumer.
 */
export {
  cellSize,
  distanceToEdge,
  driftNoise,
  samplePlanting,
  type PlantPlacement,
  type SampleOptions,
} from '@garden-studio/schema';
