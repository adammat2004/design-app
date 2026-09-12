/**
 * The shared model, imported by both apps.
 *
 * IMPORTANT: this package has a single `"."` export subpath, so **a file that is not
 * re-exported here does not exist as far as the apps are concerned** — the import will simply
 * fail to resolve, with no hint that the file is sitting right there. Add every new module to
 * the list below.
 *
 * Both apps compile against `dist/`, so run `pnpm --filter @garden-studio/schema build` (or
 * leave its `dev` watcher running) after changing anything here. Type errors in the apps that
 * look stale are almost always this.
 */

export * from './geometry/primitives.js';

export * from './geometry/shapes.js';
export * from './geometry/wkt.js';

export * from './plan/units.js';
export * from './plan/zone-id.js';
export * from './plan/along-edge.js';
export * from './plan/opening.js';
export * from './plan/gate.js';
export * from './plan/boundary-style.js';
export * from './plan/site.js';
export * from './plan/openings.js';
export * from './plan/gates.js';
export * from './plan/boundary-styles.js';
export * from './plan/planting.js';
export * from './plan/planting-sample.js';
export * from './plan/prng.js';
export * from './plan/sanity.js';
export * from './plan/plot-presets.js';
export * from './plan/zones.js';
export * from './plan/scope.js';
export * from './plan/edging.js';
export * from './plan/features.js';
export * from './plan/levels.js';
export * from './plan/brief.js';
export * from './plan/materials.js';
export * from './plan/material-patterns.js';
export * from './plan/concepts.js';
export * from './plan/symbols.js';
export * from './plan/heights.js';
export * from './plan/sun.js';
export * from './plan/shadows.js';
export * from './plan/quantities.js';
export * from './plan/composition.js';
export * from './plan/document.js';
export * from './plan/validation.js';
export * from './plan/assistant.js';
export * from './plan/assistant-garden.js';
export * from './plan/api.js';

export * from './plan/plant-catalogue.js';
