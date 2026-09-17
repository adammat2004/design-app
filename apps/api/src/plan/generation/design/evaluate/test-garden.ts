import {
  rectToPolygon,
  type DesignElement,
  type PlanGeometry,
  type Point,
} from '@garden-studio/schema';

/**
 * Gardens built by hand, in world metres, for the scorer to read.
 *
 * Extracted from `evaluate.test.ts`, where these helpers were local functions. They are here so the
 * **gallery** can use the identical builders the unit tests do: a fixture the benchmark measures and
 * a fixture the tests pin have to be the same kind of object, or the two describe different gardens
 * and only one of them is the one anybody looked at.
 *
 * Built by hand rather than generated, deliberately. A fixture that came out of the generator can
 * only ever confirm what the generator already does — the same argument `composition-rules.ts` makes
 * about deriving its bands from a traced professional plan instead of from this generator's output.
 *
 * Nothing here imports a test framework, so it is ordinary code that a script can run.
 */

/** A rectangle about its own centre, in world metres. Degrees clockwise, as everywhere else. */
export function rect(
  x: number,
  y: number,
  width: number,
  depth: number,
  rotation = 0,
): Extract<PlanGeometry, { kind: 'rect' }> {
  return { kind: 'rect', centre: { x, y }, width, depth, rotation };
}

/**
 * The same rectangle as a polygon.
 *
 * Fills are polygons on every generated plan — `remainderPieces` and `clipTo` return rings — so a
 * hand-built fill drawn as a rect would be a shape the realised tier never actually meets.
 */
export function panel(
  x: number,
  y: number,
  width: number,
  depth: number,
  rotation = 0,
): Extract<PlanGeometry, { kind: 'polygon' }> {
  return {
    kind: 'polygon',
    points: rectToPolygon(rect(x, y, width, depth, rotation)),
    cornerRadius: 0,
  };
}

export interface GardenBuilder {
  /** A placed thing: a terrace, a shed, a play area. Paved stone unless told otherwise. */
  feature: (name: string, shape: PlanGeometry, over?: Partial<DesignElement>) => DesignElement;
  /** Ground: a lawn panel, a border, or the base fill of a zone. */
  fill: (
    category: DesignElement['category'],
    shape: PlanGeometry,
    over?: Partial<DesignElement>,
  ) => DesignElement;
  /** A route. Setts at 1.2 m, which is what `circulationFor` gives an access path. */
  path: (
    points: Point[],
    width?: number,
    name?: string,
    over?: Partial<DesignElement>,
  ) => DesignElement;
}

/**
 * A source of elements with its own id counter.
 *
 * Per builder rather than per module, so a garden's ids do not depend on how many other gardens
 * happened to be built first. The gallery is read by a benchmark that prints ids, and an id that
 * moves when an unrelated fixture is added makes two runs impossible to compare.
 */
export function gardenBuilder(prefix = 'e'): GardenBuilder {
  let counter = 0;
  const id = () => {
    counter += 1;
    return `${prefix}${counter}`;
  };

  const feature: GardenBuilder['feature'] = (name, shape, over = {}) => ({
    id: id(),
    category: 'paved-area',
    role: 'feature',
    name,
    shape,
    zone: 'back',
    material: 'stone-pavers',
    ...over,
  });

  const fill: GardenBuilder['fill'] = (category, shape, over = {}) => ({
    id: id(),
    category,
    role: 'fill',
    fillKind: 'accent',
    shape,
    zone: 'back',
    material: category === 'lawn' ? 'standard-turf' : 'mixed-border',
    ...over,
  });

  const path: GardenBuilder['path'] = (points, width = 1.2, name = 'Service path', over = {}) =>
    feature(name, { kind: 'polyline', points, width }, { material: 'stone-setts', ...over });

  return { feature, fill, path };
}
