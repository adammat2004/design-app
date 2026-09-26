/**
 * The plan canvases' palette. Kept out of the components so every screen that draws the
 * property — the boundary editor and the existing-features editor — tints it identically.
 * Feature status colours live separately, in `feature-colours.ts`.
 */
export const COLOUR = {
  stroke: '#2f7a3e',
  fill: 'rgba(120, 168, 116, 0.10)',
  handle: '#1b4332',
  gridMinor: '#e4eae2',
  gridMajor: '#cfd9cc',
  guide: '#9db89b',
  /** Dimension readouts between the house and the fence. */
  measurement: '#5b6560',
  /** Snap lines that flash when an edge comes into agreement with another. */
  alignment: '#2f7a3e',
  houseFill: '#e9ecef',
  houseStroke: '#5b6560',
  houseInk: '#33413a',
  /** The wall itself, drawn as a band of real thickness — see `WALL_THICKNESS`. */
  houseWall: '#4d565d',
  /** The fence's shade, at the alpha `FENCE_SHADE_OPACITY` gives it. */
  fenceShade: '#4a5a63',
  /** The boundary drawn as an enclosure rather than an outline: rail and posts. */
  fenceRail: '#9a8460',
  fencePost: '#7a6747',
  /**
   * What the AI designer draws with while it is working on the plan.
   *
   * Its own colour rather than the selection green, because the two are on screen at the same time
   * and mean different things — one is what *you* have selected, the other is what something else
   * is doing to your garden. Deliberately not the clash red either: this canvas already uses red
   * for "that edit was refused", and an AI cursor in the same colour would read as a fault every
   * time it appeared.
   */
  ai: '#4338ca',
  aiWash: 'rgba(67, 56, 202, 0.08)',
  /**
   * A side of the selected surface that carries its edging course, and the toggle for it.
   *
   * A warm brick rather than the selection green or the AI indigo: green already means "this is
   * what you have selected" and both colours are on screen at once round the same shape, so the
   * side toggles have to read as a property of the thing rather than a second selection of it.
   */
  edging: '#b5623a',
  edgingOff: 'rgba(181, 98, 58, 0.35)',
};

/**
 * How each treatment is drawn *as a control* on the plan, while its surface's edges are open.
 *
 * Not the material — the rendered course is underneath and already shows that. These are the
 * editing overlay's colours, chosen to be told apart from one another at a glance and from the
 * selection green and the AI indigo, since all three can be on screen round one shape. `none` has
 * no entry: a bare stretch is drawn as the faint dashed boundary, which is what "nothing here"
 * looks like.
 */
export const EDGE_TREATMENT_COLOUR: Record<string, string> = {
  flush: '#6b7280',
  brick: '#b5623a',
  stone: '#7c8795',
  steel: '#334155',
  timber: '#8b6a43',
  kerb: '#9ca3af',
};
