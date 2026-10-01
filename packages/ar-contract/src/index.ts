/*
 * The AR scene format, shared by whatever builds scenes (the web/API side) and whatever draws
 * them (apps/mobile). Depends on zod and nothing else — see `docs/ar/ar-architecture.md`.
 */
export * from './coordinates.js';
export * from './vocabulary.js';
export * from './scene.js';
export * from './mesh-helpers.js';
export * from './model-library.js';
