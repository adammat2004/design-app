# `ar/engine/` — the only folder that talks to the AR library

Nothing is here yet. The first milestone (see `docs/ar/ar-architecture.md`) adds ViroReact and puts
**every** import of `@reactvision/react-viro` in this folder:

- `ArView.tsx`: the AR session, plane detection, hit testing and the one root node the whole garden
  hangs from.
- One small component per node kind (`surface`, `solid`, `model`, `plants`) that turns a node from
  the scene into Viro components. Surfaces and solids arrive as ready-made triangle meshes, so they
  map onto a custom-geometry component, not onto hand-placed boxes.

Keeping the library behind this folder is what makes it replaceable. If Viro fails the spike, or the
project later outgrows it (for example a RealityKit/ARCore native module), only this folder changes.
Nothing outside it should know which engine is drawing.
