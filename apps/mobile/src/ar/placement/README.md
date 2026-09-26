# `ar/placement/` — putting the design into the real garden

Pure TypeScript, no Viro and no React. Keep it unit-testable.

The whole garden is one root node. Placement only ever sets that node's transform: a translation
and a rotation about the vertical axis. Scale stays at 1, because real size is the point; tabletop
mode is a separate, clearly labelled mode. Nothing inside the scene is ever moved.

Suggested order (details in `docs/ar/ar-architecture.md`, "Placement"):

1. **Tap and turn.** Tap the ground where the scene origin (the foot of the garden door) is, then
   twist to rotate. Good enough for the first milestone; too coarse for a real garden, because one
   degree out is 17 cm at 10 m.
2. **Two points on the house wall.** The user taps the ground at both ends of the back wall
   (`referencePoints` with `kind: 'house-corner'`). Solve the rotation from the two vectors and the
   translation from the first point. Report the measured length against the design's length, since
   a big difference means the plan's house is drawn at the wrong size.
3. Later: a third point for sloping ground, printed markers, and saved anchors.
