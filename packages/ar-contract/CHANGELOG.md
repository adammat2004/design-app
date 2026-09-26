# @garden-studio/ar-contract

The AR scene format is the one piece of code both developers depend on, so it changes by agreement.

- **Additive by default.** A new optional field, or a node kind an older reader can skip, needs no
  version bump.
- **Breaking changes bump `AR_SCENE_VERSION`** and set `minReaderVersion`, so an older app refuses
  the scene instead of drawing it wrongly.
- **Both developers review** every change to this package. A contract PR touches only this package
  and its fixtures; the builder and the renderer follow in their own PRs.

## 0.0.1 — draft v0

- `ARSceneSchema` with four node kinds: `surface`, `solid`, `model`, `plants`.
- The coordinate convention (`planToScene`, `yawFromPlanDegrees`), pinned by tests against the
  plan's own `rectToPolygon`.
- `readARScene`, which refuses a scene written for a newer reader before validating it.
- Fixture-grade mesh helpers: `flatPolygonMesh`, `boxMesh`, `mergeMeshes`.
