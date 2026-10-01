# @garden-studio/ar-contract

The AR scene format is the one piece of code both developers depend on, so it changes by agreement.

- **Additive by default.** A new optional field, or a node kind an older reader can skip, needs no
  version bump.
- **Breaking changes bump `AR_SCENE_VERSION`** and set `minReaderVersion`, so an older app refuses
  the scene instead of drawing it wrongly.
- **Both developers review** every change to this package. A contract PR touches only this package
  and its fixtures; the builder and the renderer follow in their own PRs.

## 0.0.3 — additive (awaiting review by both developers)

The model library: 3D models of garden products (a gazebo first) generated with Meshy, reviewed by a
person and checked in. A renderer draws one in place of a node's own geometry where the builder
says it fits. Everything is optional, so a 0.0.2 reader draws a 0.0.3 scene exactly as before.

- `AssetRef` and `asset?` on `SolidNode` and `ModelNode`: a library model id, and the base centre,
  yaw and **size** to draw it at. Scaled per axis to exactly `size`; there is still no `scale`. The
  node's own geometry stays complete and is what draws without the library, without the id, or while
  the file loads.
- `ModelLibrarySchema` / `ModelLibraryEntrySchema` (`model-library.ts`): the manifest both renderers
  read. An entry promises metres, +Y up, the base centred on the origin and the front towards +Z,
  so a renderer applies no correction; and it is immutable once published — a regenerated model is
  a new id.
- The scene still never names a file: `AssetRef.id` is looked up in the library, the way `ModelKey`
  is looked up in a renderer's manifest.
- `ModelLibraryEntry.heightStretch` (optional): how far a reviewer stretched the model upright to the
  height its spec asked for. Provenance only; `naturalSize` is already the published size.

## 0.0.2 — additive (awaiting review by both developers)

Every field below is optional, so a v0 reader draws a 0.0.2 scene exactly as before and there is no
version bump. Each exists because the web's structure editor draws something the scene could not say.

- `Mesh.uv`: `world` (absent, as before) or `face` — metres along each face. World XZ UVs degenerate
  on a vertical face, so a textured wall or post had nothing to tile by.
- `ARMaterial.tones` and `PlantsNode.instances[].tone`: a bed's plants in its planting's own few
  colours rather than one flat green.
- `PlantsNode.species` and `ModelNode.species`: the `PlantSpecies` id where the plan names one.
- `SolidNode.openings` and `OpeningKind`: the house's doors and windows, as spans with sill and head
  heights, so the garden door can be found in the real garden and the house reads as a house.
- `SolidNode.hedge`: this solid is a clipped hedge (a hedge boundary or a hedging bed), with its
  outline and height, so a renderer that draws foliage can draw it as foliage; `parts` stays the
  plain block for one that cannot.

## 0.0.1 — draft v0

- `ARSceneSchema` with four node kinds: `surface`, `solid`, `model`, `plants`.
- The coordinate convention (`planToScene`, `yawFromPlanDegrees`), pinned by tests against the
  plan's own `rectToPolygon`.
- `readARScene`, which refuses a scene written for a newer reader before validating it.
- Fixture-grade mesh helpers: `flatPolygonMesh`, `boxMesh`, `mergeMeshes`.
