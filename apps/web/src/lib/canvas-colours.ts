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
  /** The boundary drawn as an enclosure rather than an outline: rail and posts. */
  fenceRail: '#9a8460',
  fencePost: '#7a6747',
};
