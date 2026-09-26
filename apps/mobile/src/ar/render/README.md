# `ar/render/` — from a scene to what the phone can afford to draw

Pure TypeScript, no Viro. It takes an `ARScene` and returns a render plan for `ar/engine/`:

- **Which nodes are shown.** Hidden-by-default ones, such as the existing house and fences, go
  behind a toggle.
- **Merged meshes.** One mesh per material rather than one per node, because draw calls are what a
  phone pays for.
- **The model file for each `ModelKey`, or its fallback shape.** A missing model is a box of the
  right size, never a missing object.
- **Budgets.** A cap on plant instances and on triangles, and a coarser model for things far away.
  Viro has no GPU instancing, so every plant is a node.

It must never move, resize or re-lay anything. Positions and sizes come from the scene; this folder
only decides how cheaply to draw them.
