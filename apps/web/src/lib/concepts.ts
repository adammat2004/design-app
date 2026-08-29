/**
 * A concept is data, not a picture: geometry in the same metres-origin-top-left frame as steps
 * 1 and 2, drawn by the same Konva canvas. That is what makes it measurable, editable and
 * eventually costable.
 *
 * The model moved into `@garden-studio/schema` when generation moved to the server —
 * `describeElement` with it, because the assistant writes its before/after lines with exactly
 * the same function the editor labels a shape with.
 */
export {
  countIncluded,
  describeElement,
  describeGeometry,
  elementAnchor,
  elementArea,
  elementOutline,
  featureElements,
  fillElements,
  isLocked,
  type DesignElement,
  type ElementCategory,
  type ElementRole,
  type GeneratedConcept,
  type RequestedFeatureCheck,
} from '@garden-studio/schema';
