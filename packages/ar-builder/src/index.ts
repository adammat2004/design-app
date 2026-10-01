/**
 * `PlanDocument → ARScene`. See `docs/ar/ar-architecture.md` and "Augmented reality" in CLAUDE.md.
 *
 * Its own package, not a module of the schema, because `ar-contract` already depends on the schema
 * (for its vocabulary test) and the schema depending back on the contract would be a cycle.
 */
export * from './build.js';
export * from './types.js';
export * from './library/match.js';
export { northOf, referencePoints, sceneFrame } from './frame.js';
export { cutSurface, flatMesh, prismMesh, pyramidMesh } from './mesh.js';
