import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RECTANGLE_PLOT,
  fitsOnWall,
  houseWalls,
  openingCentre,
  rectanglePlotOutline,
} from '@garden-studio/schema';
import { draftPolygon, pointInPolygon, polygonArea, vertexLabel } from '@/lib/boundary-geometry';
import { houseSize, housePolygon } from '@/lib/house';
import type { ZoneId } from '@/lib/zones';
import {
  effectiveZoneIds,
  resetBoundaryStoreForTests,
  selectZones,
  useBoundaryStore,
} from './boundary-store';

const store = () => useBoundaryStore.getState();

/** Draws a 20 m x 16 m plot and closes it. */
function drawPlot(): void {
  const { addVertexAt, closeShape } = store();
  addVertexAt({ x: 0, y: 0 });
  addVertexAt({ x: 20, y: 0 });
  addVertexAt({ x: 20, y: 16 });
  addVertexAt({ x: 0, y: 16 });
  closeShape();
}

function placeHouse(): void {
  store().placeHouseRectangle({ x: 10, y: 8 }, 8, 6);
}

function labels(): string[] {
  return store().present.vertices.map((_, index) => vertexLabel(index));
}

function zoneIds(): ZoneId[] {
  return selectZones(store()).map((zone) => zone.id);
}

beforeEach(() => {
  // The store is a module singleton and would otherwise leak between cases.
  resetBoundaryStoreForTests();
});

describe('drawing the boundary', () => {
  it('starts empty in boundary mode', () => {
    expect(store().present.vertices).toEqual([]);
    expect(store().present.closed).toBe(false);
    expect(store().mode).toBe('boundary');
    expect(store().boundaryTool).toBe('draw');
  });

  it('closing the plot hands the user straight to the house tool', () => {
    drawPlot();

    expect(store().present.closed).toBe(true);
    expect(store().mode).toBe('house');
    expect(store().houseTool).toBe('rectangle');
  });

  it('closes when the user clicks back near the first corner', () => {
    const { addVertexAt } = store();
    addVertexAt({ x: 0, y: 0 });
    addVertexAt({ x: 10, y: 0 });
    addVertexAt({ x: 10, y: 8 });
    addVertexAt({ x: 0.2, y: 0.1 });

    expect(store().present.closed).toBe(true);
    expect(store().present.vertices).toHaveLength(3);
  });

  it('will not close below three corners', () => {
    store().addVertexAt({ x: 0, y: 0 });
    store().addVertexAt({ x: 5, y: 0 });
    store().closeShape();

    expect(store().present.closed).toBe(false);
  });

  it('ignores further points once closed', () => {
    drawPlot();
    store().addVertexAt({ x: 5, y: 5 });

    expect(store().present.vertices).toHaveLength(4);
  });
});

describe('editing the boundary', () => {
  it('relabels everything after an insert', () => {
    drawPlot();
    expect(labels()).toEqual(['A', 'B', 'C', 'D']);

    store().insertVertexOnEdge(1, { x: 20, y: 8 });

    expect(labels()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(store().present.vertices[2]).toMatchObject({ x: 20, y: 8 });
  });

  it('stitches the neighbours together on delete', () => {
    drawPlot();
    const [, b] = store().present.vertices;
    store().deleteVertex(b.id);

    expect(store().present.vertices.map((v) => [v.x, v.y])).toEqual([
      [0, 0],
      [20, 16],
      [0, 16],
    ]);
  });

  it('refuses to delete below three corners', () => {
    drawPlot();
    const ids = store().present.vertices.map((v) => v.id);
    store().deleteVertex(ids[0]);
    store().deleteVertex(ids[1]);

    expect(store().present.vertices).toHaveLength(3);
  });

  it('deselects a corner it has just removed', () => {
    drawPlot();
    const b = store().present.vertices[1];
    store().select({ kind: 'vertex', id: b.id });
    store().deleteVertex(b.id);

    expect(store().selection).toBeNull();
  });

  it('moves only the far end of an edited edge', () => {
    drawPlot();
    store().setEdgeLength(0, 4);

    expect(store().present.vertices[0]).toMatchObject({ x: 0, y: 0 });
    expect(store().present.vertices[1]).toMatchObject({ x: 4, y: 0 });
    expect(store().present.vertices[2]).toMatchObject({ x: 20, y: 16 });
  });

  it('moves the last corner, not A, when the closing edge is edited', () => {
    drawPlot();
    store().setEdgeLength(3, 2);

    expect(store().present.vertices[0]).toMatchObject({ x: 0, y: 0 });
    expect(store().present.vertices[3]).toMatchObject({ x: 0, y: 2 });
  });

  it('does not record history when the length is unchanged', () => {
    // A length field blurs on the way to the Undo button and re-commits its current value;
    // that must not bury the real edit under a no-op entry.
    drawPlot();
    const depth = store().past.length;
    store().setEdgeLength(0, 20);

    expect(store().past).toHaveLength(depth);
  });
});

describe('placing the house', () => {
  it('starts with no house', () => {
    drawPlot();
    expect(store().present.house).toBeNull();
    expect(zoneIds()).toEqual([]);
  });

  it('places a rectangle and selects it', () => {
    drawPlot();
    placeHouse();

    expect(houseSize(store().present.house!)).toEqual({ width: 8, depth: 6 });
    expect(store().selection).toEqual({ kind: 'house' });
    expect(store().houseTool).toBe('move');
  });

  it('refuses a rectangle that will not fit inside the plot', () => {
    drawPlot();
    store().placeHouseRectangle({ x: 10, y: 8 }, 40, 40);

    expect(store().present.house).toBeNull();
  });

  it('builds a custom outline from clicked points', () => {
    drawPlot();
    store().setHouseTool('custom');
    for (const point of [
      { x: 6, y: 5 },
      { x: 14, y: 5 },
      { x: 14, y: 11 },
      { x: 6, y: 11 },
    ]) {
      store().addHousePoint(point);
    }
    store().closeHouseShape();

    expect(store().present.house).not.toBeNull();
    expect(polygonArea(housePolygon(store().present.house!))).toBeCloseTo(48);
    expect(store().housePoints).toEqual([]);
  });

  it('keeps the clicked points on screen when the custom outline does not fit', () => {
    drawPlot();
    store().setHouseTool('custom');
    for (const point of [
      { x: -5, y: 5 },
      { x: 25, y: 5 },
      { x: 25, y: 11 },
    ]) {
      store().addHousePoint(point);
    }
    store().closeHouseShape();

    expect(store().present.house).toBeNull();
    expect(store().housePoints).toHaveLength(3);
  });

  it('selects every zone as soon as the house lands', () => {
    drawPlot();
    placeHouse();

    expect(store().present.selectedZoneIds.sort()).toEqual(['back', 'front', 'left', 'right']);
  });

  it('clears the house and its zones', () => {
    drawPlot();
    placeHouse();
    store().removeHouse();

    expect(store().present.house).toBeNull();
    expect(zoneIds()).toEqual([]);
    expect(store().selection).toBeNull();
  });
});

describe('moving and resizing the house', () => {
  it('clamps a drag that would push the house through a fence', () => {
    drawPlot();
    placeHouse();
    store().moveHouseLive({ x: 60, y: 8 });

    const polygon = housePolygon(store().present.house!);
    expect(Math.max(...polygon.map((p) => p.x))).toBeLessThanOrEqual(20.000001);
  });

  it('records one history entry for a whole drag', () => {
    drawPlot();
    placeHouse();
    const depth = store().past.length;

    store().beginGesture();
    store().moveHouseLive({ x: 11, y: 8 });
    store().moveHouseLive({ x: 12, y: 8 });
    store().moveHouseLive({ x: 13, y: 9 });
    store().endGesture();

    expect(store().past).toHaveLength(depth + 1);

    store().undo();
    expect(store().present.house!.centre).toEqual({ x: 10, y: 8 });
  });

  it('records nothing for a drag that ends where it started', () => {
    drawPlot();
    placeHouse();
    const depth = store().past.length;

    store().beginGesture();
    store().moveHouseLive({ x: 11, y: 8 });
    store().moveHouseLive({ x: 10, y: 8 });
    store().endGesture();

    expect(store().past).toHaveLength(depth);
  });

  it('resizes from the panel', () => {
    drawPlot();
    placeHouse();
    store().setHouseSize({ width: 12 });

    expect(houseSize(store().present.house!)).toEqual({ width: 12, depth: 6 });
  });

  it('rejects a resize that would not fit rather than half-applying it', () => {
    drawPlot();
    placeHouse();
    store().setHouseSize({ width: 40 });

    expect(houseSize(store().present.house!).width).toBe(8);
  });

  it('rotates from the panel and wraps the angle', () => {
    drawPlot();
    placeHouse();
    store().setHouseRotation(450);

    expect(store().present.house!.rotation).toBe(90);
  });

  it('rejects a rotation that would swing the house out of the plot', () => {
    drawPlot();
    // Long and thin: it fits east-west but not north-south.
    store().placeHouseRectangle({ x: 10, y: 8 }, 19, 4);
    store().setHouseRotation(90);

    expect(store().present.house!.rotation).toBe(0);
  });

  it('nudges the house with the arrow keys', () => {
    drawPlot();
    placeHouse();
    store().nudgeHouse(0.5, 0);

    expect(store().present.house!.centre.x).toBeCloseTo(10.5);
  });
});

describe('starting from a preset', () => {
  it('lays out a closed rectangle of the size asked for', () => {
    store().setPlotOutline(rectanglePlotOutline(DEFAULT_RECTANGLE_PLOT));

    expect(store().present.closed).toBe(true);
    expect(store().present.vertices).toHaveLength(4);
    expect(polygonArea(draftPolygon(store().present))).toBeCloseTo(96);
  });

  /*
   * Retyping a width must not invalidate the selection or every React key on the canvas, so ids
   * are reused positionally when the corner count is unchanged.
   */
  it('keeps the corner ids when a dimension is retyped', () => {
    store().setPlotOutline(rectanglePlotOutline({ width: 12, depth: 8 }));
    const ids = store().present.vertices.map((vertex) => vertex.id);

    store().setPlotOutline(rectanglePlotOutline({ width: 14, depth: 9 }));

    expect(store().present.vertices.map((vertex) => vertex.id)).toEqual(ids);
    expect(polygonArea(draftPolygon(store().present))).toBeCloseTo(126);
  });

  it('does not throw the user into house placement mid-keystroke', () => {
    store().setPlotOutline(rectanglePlotOutline(DEFAULT_RECTANGLE_PLOT));

    // Closing a hand-drawn outline advances the wizard; a preset offers the step instead.
    expect(store().mode).toBe('boundary');
  });

  it('refuses an outline that crosses itself or has nothing in it', () => {
    const bowTie = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 16 },
      { x: 20, y: 16 },
    ];

    store().setPlotOutline(bowTie);
    expect(store().present.vertices).toHaveLength(0);

    store().setPlotOutline([{ x: 0, y: 0 }]);
    expect(store().present.vertices).toHaveLength(0);
  });

  it('is one undo entry', () => {
    store().setPlotOutline(rectanglePlotOutline(DEFAULT_RECTANGLE_PLOT));
    store().undo();

    expect(store().present.vertices).toHaveLength(0);
  });
});

describe('drawing with right angles', () => {
  it('holds each new side square to the one before it', () => {
    const { addVertexAt } = store();
    addVertexAt({ x: 0, y: 0 });
    addVertexAt({ x: 20, y: 0 });
    // Aimed low and wide; the side is held vertical and the run kept.
    addVertexAt({ x: 21.4, y: 16.2 });

    const third = store().present.vertices[2]!;
    expect(third.x).toBeCloseTo(20);
    expect(third.y).toBeCloseTo(16);
  });

  it('lets the pointer go anywhere once right angles are off', () => {
    store().toggleRightAngle();
    const { addVertexAt } = store();
    addVertexAt({ x: 0, y: 0 });
    addVertexAt({ x: 20, y: 0 });
    addVertexAt({ x: 21.4, y: 16.2 });

    expect(store().present.vertices[2]!.x).toBeCloseTo(21.5);
  });

  /*
   * Snapping projects the point onto an axis, which can carry it further from corner A than
   * `CLOSE_DISTANCE`. Testing the close against the snapped point would make the polygon refuse to
   * close exactly when the user aimed at the corner to close it.
   */
  it('still closes when the user aims at the first corner', () => {
    const { addVertexAt } = store();
    addVertexAt({ x: 0, y: 0 });
    addVertexAt({ x: 20, y: 0 });
    addVertexAt({ x: 20, y: 16 });
    addVertexAt({ x: 0, y: 16 });
    addVertexAt({ x: 0.2, y: 0.2 });

    expect(store().present.closed).toBe(true);
    expect(store().present.vertices).toHaveLength(4);
  });
});

describe('placing a corner by measurement', () => {
  it('walks the length and turn it is given, exactly', () => {
    store().addVertexAt({ x: 0, y: 0 });
    store().addVertexByMeasurement(12.4, 0);
    store().addVertexByMeasurement(8.3, 90);

    const [, second, third] = store().present.vertices;
    expect(second!.x).toBeCloseTo(12.4);
    expect(third!.x).toBeCloseTo(12.4);
    expect(third!.y).toBeCloseTo(8.3);
  });

  it('has nowhere to measure from before the first corner', () => {
    store().addVertexByMeasurement(12, 90);

    expect(store().present.vertices).toHaveLength(0);
  });

  it('refuses a nonsense length rather than placing a corner on top of the last one', () => {
    store().addVertexAt({ x: 0, y: 0 });
    store().addVertexByMeasurement(0, 90);
    store().addVertexByMeasurement(Number.NaN, 90);

    expect(store().present.vertices).toHaveLength(1);
  });

  it('stops once the outline is closed', () => {
    drawPlot();
    store().addVertexByMeasurement(5, 90);

    expect(store().present.vertices).toHaveLength(4);
  });
});

describe('editing a side length', () => {
  it('pins the previous corner and slides the next one', () => {
    drawPlot();
    store().setEdgeLength(0, 10);

    const [a, b, c] = store().present.vertices;
    expect(a).toMatchObject({ x: 0, y: 0 });
    expect(b).toMatchObject({ x: 10, y: 0 });
    // Only one corner moves; the rest of the outline is left alone.
    expect(c).toMatchObject({ x: 20, y: 16 });
  });

  /*
   * Sliding one corner along its side can walk it straight through the opposite side, and a bow
   * tie has an ordinary vertex list with a quietly wrong area. Refusing leaves the last legal
   * outline on screen.
   */
  it('refuses an edit that folds the outline through itself', () => {
    // A C-shaped plot: convex outlines cannot fold, so the guard needs a notch to fold into.
    const { addVertexAt, closeShape } = store();
    for (const corner of [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 15 },
      { x: 20, y: 15 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ]) {
      addVertexAt(corner);
    }
    closeShape();

    const before = draftPolygon(store().present);
    // Side C->D runs left along y = 5. Pushed out to 40 m it passes clean through the left wall.
    store().setEdgeLength(2, 40);

    expect(draftPolygon(store().present)).toEqual(before);
  });

  it('still allows an edit that only makes the plot bigger', () => {
    drawPlot();
    store().setEdgeLength(0, 30);

    expect(store().present.vertices[1]).toMatchObject({ x: 30, y: 0 });
  });

  it('remembers which side is being edited, for the plan to show', () => {
    drawPlot();
    store().previewEdgeReflow(2);
    expect(store().reflowEdgeIndex).toBe(2);

    store().previewEdgeReflow(null);
    expect(store().reflowEdgeIndex).toBeNull();
  });
});

describe('rescaling the plot', () => {
  it('divides the area by the square of the factor', () => {
    drawPlot();
    const before = polygonArea(draftPolygon(store().present));

    store().scalePlot(0.1);

    expect(polygonArea(draftPolygon(store().present))).toBeCloseTo(before / 100);
  });

  it('scales about the plot centroid, so the plot stays where it was', () => {
    drawPlot();
    store().scalePlot(0.1);

    // The 20 x 16 plot is centred on (10, 8); a tenth of it is 2 x 1.6 about that same point.
    const polygon = draftPolygon(store().present);
    expect(polygon[0]!.x).toBeCloseTo(9);
    expect(polygon[0]!.y).toBeCloseTo(7.2);
    expect(polygon[2]!.x).toBeCloseTo(11);
    expect(polygon[2]!.y).toBeCloseTo(8.8);
  });

  /*
   * The bug this is here to catch: scaling the plot and leaving the building full size. The house
   * then no longer fits, and every later house edit is refused by `commitHouse` for a reason the
   * user cannot see anywhere on screen.
   */
  it('shrinks the house with it, outline and all', () => {
    drawPlot();
    placeHouse();

    store().scalePlot(0.1);

    const house = store().present.house!;
    expect(houseSize(house).width).toBeCloseTo(0.8);
    expect(houseSize(house).depth).toBeCloseTo(0.6);
    expect(house.centre.x).toBeCloseTo(10);
    expect(house.centre.y).toBeCloseTo(8);
  });

  it('leaves the house still fitting inside the plot', () => {
    drawPlot();
    placeHouse();
    store().scalePlot(0.1);

    const polygon = draftPolygon(store().present);
    for (const corner of housePolygon(store().present.house!)) {
      expect(pointInPolygon(corner, polygon)).toBe(true);
    }
  });

  /*
   * The real scenario: a plot drawn ten times too large, scaled back to an ordinary garden. The
   * zones have to survive that, because the user has already ticked which of them to design.
   */
  it('keeps the garden areas the user picked', () => {
    const { addVertexAt, closeShape } = store();
    addVertexAt({ x: 0, y: 0 });
    addVertexAt({ x: 200, y: 0 });
    addVertexAt({ x: 200, y: 160 });
    addVertexAt({ x: 0, y: 160 });
    closeShape();
    // Placing the house is what puts every zone in scope; nothing else needs to tick them.
    store().placeHouseRectangle({ x: 100, y: 80 }, 80, 60);
    const chosen = store().present.selectedZoneIds;
    expect(chosen).toEqual(['front', 'back', 'left', 'right']);

    store().scalePlot(0.1);

    expect(store().present.selectedZoneIds).toEqual(chosen);
    expect(zoneIds()).toEqual(['front', 'right', 'back', 'left']);
  });

  /*
   * A rescale is not zone-preserving in general, and the store comment says so. `MIN_ZONE_AREA` is
   * an absolute 0.5 m², so dividing every length by ten divides every zone area by a hundred —
   * here the front and back bands fall under it and dissolve. The ticks stay in the document, which
   * is exactly what `effectiveZoneIds` exists to reconcile, so the choice comes back if the zone does.
   */
  it('can dissolve a zone into a sliver without losing the tick', () => {
    drawPlot();
    placeHouse();

    store().scalePlot(0.1);

    expect(zoneIds()).toEqual(['right', 'left']);
    expect(store().present.selectedZoneIds).toEqual(['front', 'back', 'left', 'right']);
    expect(effectiveZoneIds(store().present, selectZones(store()))).toEqual(['right', 'left']);

    store().scalePlot(10);
    expect(zoneIds()).toEqual(['front', 'right', 'back', 'left']);
  });

  it('is one undo entry', () => {
    drawPlot();
    const depth = store().past.length;

    store().scalePlot(0.1);

    expect(store().past.length).toBe(depth + 1);
    store().undo();
    expect(polygonArea(draftPolygon(store().present))).toBeCloseTo(320);
  });

  it('refuses a plot with nothing to scale, and a factor that is not one', () => {
    store().addVertexAt({ x: 0, y: 0 });
    store().addVertexAt({ x: 20, y: 0 });
    store().scalePlot(0.1);
    expect(store().present.vertices).toHaveLength(2);
    expect(store().present.vertices[1]!.x).toBe(20);

    drawPlot();
    const polygon = draftPolygon(store().present);
    store().scalePlot(0);
    expect(draftPolygon(store().present)).toEqual(polygon);
  });

  it('keeps the vertex ids, so selection and drag targets survive', () => {
    drawPlot();
    const ids = store().present.vertices.map((vertex) => vertex.id);

    store().scalePlot(0.1);

    expect(store().present.vertices.map((vertex) => vertex.id)).toEqual(ids);
  });
});

describe('walls and openings', () => {
  function houseNow() {
    return store().present.house!;
  }

  function wallIds(): string[] {
    return houseWalls(houseNow()).map((wall) => wall.id);
  }

  beforeEach(() => {
    drawPlot();
    placeHouse();
  });

  it('adds an opening in the middle of an empty wall', () => {
    store().addOpening(wallIds()[0]!, 'patio-door');

    const [opening] = houseNow().openings;
    expect(opening?.type).toBe('patio-door');
    expect(opening?.width).toBeCloseTo(2.4);
    // The top wall of an 8 x 6 house is 8 m long.
    expect(opening?.offsetAlongEdge).toBeCloseTo(4);
  });

  it('puts a second one beside the first rather than through it', () => {
    const wall = wallIds()[0]!;
    store().addOpening(wall, 'patio-door');
    store().addOpening(wall, 'window');

    const [first, second] = houseNow().openings;
    expect(houseNow().openings).toHaveLength(2);
    expect(fitsOnWall(houseNow(), second!)).toBe(true);
    expect(second!.id).not.toBe(first!.id);
  });

  it('says no rather than stacking when the wall is full', () => {
    const wall = wallIds()[1]!; // The 6 m side wall.
    store().addOpening(wall, 'patio-door');
    store().addOpening(wall, 'patio-door');

    /*
     * One 2.4 m door centred on a 6 m wall spans 1.8 to 4.2, leaving two 1.8 m gaps — neither wide
     * enough for a second. The request is dropped rather than overlapped.
     */
    expect(houseNow().openings).toHaveLength(1);
    expect(houseNow().openings[0]!.offsetAlongEdge).toBeCloseTo(3);
  });

  it('does fit a second where there is genuinely room', () => {
    const wall = wallIds()[0]!; // The 8 m wall.
    store().addOpening(wall, 'back-door');
    store().addOpening(wall, 'back-door');

    expect(houseNow().openings).toHaveLength(2);
    expect(houseNow().openings.every((opening) => fitsOnWall(houseNow(), opening))).toBe(true);
  });

  it('refuses a wall that cannot hold that sort of opening', () => {
    const wall = wallIds()[0]!;
    store().setWallKind(wall, 'party');
    store().addOpening(wall, 'patio-door');

    expect(houseNow().openings).toEqual([]);
  });

  /*
   * Reclassifying takes what is already there with it. Keeping a door on a party wall would have
   * the generator design a path to a doorway into next door's kitchen.
   */
  it('clears the openings from a wall that stops being external', () => {
    const wall = wallIds()[0]!;
    store().addOpening(wall, 'patio-door');
    store().addOpening(wallIds()[1]!, 'back-door');

    store().setWallKind(wall, 'party');

    expect(houseNow().openings.map((opening) => opening.wallId)).toEqual([wallIds()[1]]);
  });

  it('slides an opening along its wall, clamped to stay on it', () => {
    const wall = wallIds()[0]!;
    store().addOpening(wall, 'patio-door');
    const id = houseNow().openings[0]!.id;

    store().moveOpening(id, 2);
    expect(houseNow().openings[0]!.offsetAlongEdge).toBeCloseTo(2);

    // Past the end: clamped rather than refused, because a drag should stop, not snap back.
    store().moveOpening(id, 99);
    expect(houseNow().openings[0]!.offsetAlongEdge).toBeCloseTo(6.8);
  });

  it('will not slide one through its neighbour', () => {
    const wall = wallIds()[0]!;
    store().addOpening(wall, 'patio-door');
    store().addOpening(wall, 'window');
    const [first, second] = houseNow().openings;
    const before = second!.offsetAlongEdge;

    store().moveOpening(second!.id, first!.offsetAlongEdge);

    expect(houseNow().openings[1]!.offsetAlongEdge).toBeCloseTo(before);
  });

  it('re-clamps the offset when widening would push it off the end', () => {
    const wall = wallIds()[0]!;
    store().addOpening(wall, 'patio-door');
    const id = houseNow().openings[0]!.id;
    store().moveOpening(id, 6.8);

    store().setOpeningWidth(id, 4);

    const opening = houseNow().openings[0]!;
    expect(opening.width).toBeCloseTo(4);
    expect(opening.offsetAlongEdge).toBeCloseTo(6);
    expect(fitsOnWall(houseNow(), opening)).toBe(true);
  });

  it('removes one', () => {
    store().addOpening(wallIds()[0]!, 'patio-door');
    store().removeOpening(houseNow().openings[0]!.id);

    expect(houseNow().openings).toEqual([]);
  });

  it('records the sill height, which is typed rather than dragged', () => {
    store().addOpening(wallIds()[0]!, 'window');
    const id = houseNow().openings[0]!.id;

    store().setOpeningSill(id, 1.1);
    expect(houseNow().openings[0]!.sillHeight).toBeCloseTo(1.1);

    store().setOpeningSill(id, -1);
    expect(houseNow().openings[0]!.sillHeight).toBeCloseTo(1.1);
  });

  /*
   * The whole point of a wall id: an opening is not stored as a coordinate, so moving the house it
   * is on requires no update at all and cannot go stale.
   */
  it('keeps an opening on its wall when the house moves and turns', () => {
    store().addOpening(wallIds()[0]!, 'patio-door');
    const opening = houseNow().openings[0]!;

    store().beginGesture();
    store().moveHouseLive({ x: 12, y: 9 });
    store().rotateHouseLive(25);
    store().endGesture();

    expect(houseNow().openings[0]).toEqual(opening);
    expect(openingCentre(houseNow(), opening)).not.toBeNull();
  });

  it('remembers which wall the strip is showing, outside the undo history', () => {
    store().selectWall('w1');
    expect(store().selectedWallId).toBe('w1');

    store().selectWall(null);
    expect(store().selectedWallId).toBeNull();
  });

  it('is one undo entry per opening', () => {
    const depth = store().past.length;
    store().addOpening(wallIds()[0]!, 'patio-door');

    expect(store().past.length).toBe(depth + 1);
    store().undo();
    expect(houseNow().openings).toEqual([]);
  });
});

describe('orientation', () => {
  it('records where north is, wrapped', () => {
    drawPlot();

    store().setOrientation(90);
    expect(store().present.orientation).toBe(90);

    store().setOrientation(-90);
    expect(store().present.orientation).toBe(270);
  });

  it('ignores a value that is not a number', () => {
    drawPlot();
    store().setOrientation(45);
    store().setOrientation(Number.NaN);

    expect(store().present.orientation).toBe(45);
  });
});

describe('zones and design areas', () => {
  it('recomputes zones as the house moves', () => {
    drawPlot();
    placeHouse();
    expect(zoneIds().sort()).toEqual(['back', 'front', 'left', 'right']);

    // Hard against the top fence leaves nothing behind the house.
    store().moveHouseLive({ x: 10, y: 3.001 });
    expect(zoneIds()).not.toContain('back');
  });

  it('toggles a single zone', () => {
    drawPlot();
    placeHouse();
    store().toggleZone('left');

    expect(store().present.selectedZoneIds).not.toContain('left');
    expect(store().present.selectedZoneIds).toContain('front');
  });

  it('select-all clears when everything is already selected, and restores otherwise', () => {
    drawPlot();
    placeHouse();

    store().toggleAllZones();
    expect(store().present.selectedZoneIds).toEqual([]);

    store().toggleAllZones();
    expect(store().present.selectedZoneIds.sort()).toEqual(['back', 'front', 'left', 'right']);
  });

  it('hides a ticked zone that no longer exists without forgetting the tick', () => {
    drawPlot();
    placeHouse();
    store().moveHouseLive({ x: 10, y: 3.001 });

    const zones = selectZones(store());
    expect(effectiveZoneIds(store().present, zones)).not.toContain('back');
    // The tick survives in the draft, so moving away brings the zone back selected.
    expect(store().present.selectedZoneIds).toContain('back');

    store().moveHouseLive({ x: 10, y: 8 });
    expect(effectiveZoneIds(store().present, selectZones(store()))).toContain('back');
  });
});

describe('property summary inputs', () => {
  it('exposes the numbers the summary panel needs', () => {
    drawPlot();
    placeHouse();

    const total = polygonArea(draftPolygon(store().present));
    const footprint = polygonArea(housePolygon(store().present.house!));

    expect(total).toBeCloseTo(320);
    expect(footprint).toBeCloseTo(48);
    expect(total - footprint).toBeCloseTo(272);
  });
});

describe('snapping', () => {
  it('rounds a placed corner to the nearest half metre', () => {
    store().addVertexAt({ x: 12.63, y: 4.44 });

    expect(store().present.vertices[0].x).toBeCloseTo(12.5);
    expect(store().present.vertices[0].y).toBeCloseTo(4.5);
  });

  it('leaves the corner exactly where it was clicked when snap is off', () => {
    store().toggleSnap();
    store().addVertexAt({ x: 12.63, y: 4.44 });

    expect(store().present.vertices[0].x).toBeCloseTo(12.63);
    expect(store().present.vertices[0].y).toBeCloseTo(4.44);
  });

  it('snaps a dragged corner', () => {
    drawPlot();
    const b = store().present.vertices[1];
    store().moveVertexLive(b.id, { x: 19.9, y: 0.2 });

    expect(store().present.vertices[1]).toMatchObject({ x: 20, y: 0 });
  });

  it('never snaps an arrow-key nudge, which would stop it nudging at all', () => {
    drawPlot();
    placeHouse();
    store().nudgeHouse(0.1, 0);

    expect(store().present.house!.centre.x).toBeCloseTo(10.1);
  });

  it('pulls a nearly flush house wall onto the fence', () => {
    drawPlot();
    placeHouse();
    // Left wall would land at 0.2; alignment snapping should take it to 0.
    store().moveHouseLive({ x: 4.2, y: 8 });

    expect(store().present.house!.centre.x).toBeCloseTo(4);
  });

  it('is on by default', () => {
    expect(store().snapEnabled).toBe(true);
  });
});

describe('the measure tool', () => {
  it('anchors on the first click and fixes on the second', () => {
    store().addMeasurePoint({ x: 1, y: 1 });
    expect(store().measurement).toEqual({ from: { x: 1, y: 1 }, to: null });

    store().addMeasurePoint({ x: 4, y: 5 });
    expect(store().measurement).toEqual({ from: { x: 1, y: 1 }, to: { x: 4, y: 5 } });
  });

  it('follows the pointer while only the anchor is placed', () => {
    store().addMeasurePoint({ x: 1, y: 1 });
    store().trackMeasurePointer({ x: 3, y: 3 });

    expect(store().measurement?.to).toEqual({ x: 3, y: 3 });
  });

  it('leaves a finished measurement alone as the pointer moves on', () => {
    store().addMeasurePoint({ x: 1, y: 1 });
    store().addMeasurePoint({ x: 4, y: 5 });
    store().trackMeasurePointer({ x: 9, y: 9 });

    expect(store().measurement?.to).toEqual({ x: 4, y: 5 });
  });

  it('starts over on a third click', () => {
    store().addMeasurePoint({ x: 1, y: 1 });
    store().addMeasurePoint({ x: 4, y: 5 });
    store().addMeasurePoint({ x: 7, y: 7 });

    expect(store().measurement).toEqual({ from: { x: 7, y: 7 }, to: null });
  });

  it('is thrown away when the tool changes', () => {
    store().addMeasurePoint({ x: 1, y: 1 });
    store().setMode('select');

    expect(store().measurement).toBeNull();
  });
});

describe('autosave stamp', () => {
  it('advances when something is committed', () => {
    const before = store().lastSavedAt;
    store().addVertexAt({ x: 1, y: 1 });

    expect(store().lastSavedAt).toBeGreaterThanOrEqual(before);
  });

  it('advances after a drag lands', () => {
    drawPlot();
    placeHouse();
    useBoundaryStore.setState({ lastSavedAt: 0 });

    store().beginGesture();
    store().moveHouseLive({ x: 11, y: 8 });
    store().endGesture();

    expect(store().lastSavedAt).toBeGreaterThan(0);
  });
});

describe('modes', () => {
  it('will not enter house mode before the plot is enclosed', () => {
    store().addVertexAt({ x: 0, y: 0 });
    store().setMode('house');

    expect(store().mode).toBe('boundary');
  });

  it('enters house mode once the plot is enclosed', () => {
    drawPlot();
    store().setMode('boundary');
    store().setMode('house');

    expect(store().mode).toBe('house');
  });
});

describe('undo, redo and reset', () => {
  it('restores a deleted corner and re-deletes it on redo', () => {
    drawPlot();
    const b = store().present.vertices[1];
    store().deleteVertex(b.id);
    expect(store().present.vertices).toHaveLength(3);

    store().undo();
    expect(store().present.vertices).toHaveLength(4);

    store().redo();
    expect(store().present.vertices).toHaveLength(3);
  });

  it('undoes across boundary and house edits alike', () => {
    drawPlot();
    placeHouse();
    store().undo();

    expect(store().present.house).toBeNull();
  });

  it('discards the redo stack once a new edit branches off', () => {
    drawPlot();
    store().undo();
    expect(store().future).toHaveLength(1);

    store().setEdgeLength(0, 6);
    expect(store().future).toHaveLength(0);
  });

  it('does nothing when there is no history left', () => {
    store().undo();
    store().redo();

    expect(store().present.vertices).toEqual([]);
  });

  it('reset clears everything but stays undoable', () => {
    drawPlot();
    placeHouse();
    store().resetDraft();

    expect(store().present.vertices).toEqual([]);
    expect(store().present.house).toBeNull();
    expect(store().mode).toBe('boundary');

    store().undo();
    expect(store().present.vertices).toHaveLength(4);
    expect(store().present.house).not.toBeNull();
  });
});
