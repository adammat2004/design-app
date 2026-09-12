import { beforeEach, describe, expect, it } from 'vitest';
import {
  BOUNDARY_HEIGHTS,
  boundaryRuns,
  DEFAULT_RECTANGLE_PLOT,
  fitsOnEdge,
  fitsOnWall,
  gateCentre,
  houseWalls,
  kindForEdge,
  openingCentre,
  rectanglePlotOutline,
} from '@garden-studio/schema';
import { draftPolygon, pointInPolygon, polygonArea, vertexLabel } from '@/lib/boundary-geometry';
import { houseFitsInside, houseSize, housePolygon } from '@/lib/house';
import type { ZoneId } from '@/lib/zones';
import {
  effectiveZoneIds,
  resetBoundaryStoreForTests,
  selectedEdgeVertexId,
  selectedWallId,
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

  /*
   * Shrunk rather than refused. The preset is one size and a plot is any size, so a click that
   * placed nothing and said nothing was the worst of the three possible answers.
   */
  it('shrinks a rectangle too big for the plot rather than placing nothing', () => {
    drawPlot();
    store().placeHouseRectangle({ x: 10, y: 8 }, 40, 40);

    const house = store().present.house;
    expect(house).not.toBeNull();
    expect(houseSize(house!).width).toBeLessThan(40);
    expect(houseFitsInside(draftPolygon(store().present), house!)).toBe(true);
  });

  it('still places nothing when the point is off the plot entirely', () => {
    drawPlot();
    store().placeHouseRectangle({ x: 60, y: 8 }, 8, 6);

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

  /*
   * _This reverses_ "reject a resize that would not fit". A house can be the full width of its
   * plot — a terrace, a bungalow between two side fences — and refusing outright left the typed
   * number in the box beside a house that had not moved. The clamp answers with the largest house
   * that fits, and it must actually reach the fence rather than stop short of it.
   */
  it('grows a resize as far as the fence instead of rejecting it', () => {
    drawPlot();
    placeHouse();
    store().setHouseSize({ width: 40 });

    const house = store().present.house!;
    expect(houseSize(house).width).toBeCloseTo(20, 3);
    expect(houseFitsInside(draftPolygon(store().present), house)).toBe(true);
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

  it('selects a wall, outside the undo history', () => {
    store().selectWall('w1');
    expect(store().selection).toEqual({ kind: 'wall', wallId: 'w1' });
    expect(selectedWallId(store())).toBe('w1');

    store().selectWall(null);
    expect(store().selection).toBeNull();
  });

  it('resolves the wall of a selected opening, so the plan and the strip agree', () => {
    store().addOpening(wallIds()[1]!, 'window');
    const [opening] = houseNow().openings;

    // Adding one selects it, and its wall is the one the editor is about.
    expect(store().selection).toEqual({ kind: 'opening', id: opening!.id });
    expect(selectedWallId(store())).toBe(wallIds()[1]);
  });

  it('drops a selected opening the wall’s new kind cannot hold', () => {
    store().addOpening(wallIds()[0]!, 'patio-door');
    const [opening] = houseNow().openings;
    expect(store().selection).toEqual({ kind: 'opening', id: opening!.id });

    store().setWallKind(wallIds()[0]!, 'party');

    expect(houseNow().openings).toEqual([]);
    expect(store().selection).toBeNull();
  });

  it('pulls an opening a resize has pushed off its wall back onto it', () => {
    store().addOpening(wallIds()[0]!, 'patio-door');
    const [opening] = houseNow().openings;
    // The top wall is 8 m; shrinking the house to 3 m leaves a 2.4 m door at 4 m hanging off it.
    store().setHouseSize({ width: 3 });
    expect(openingCentre(houseNow(), houseNow().openings[0]!)).toBeNull();

    store().fitOpening(opening!.id);

    expect(openingCentre(houseNow(), houseNow().openings[0]!)).not.toBeNull();
  });

  it('sets how a door opens, which is the one thing about it the plan cannot show', () => {
    store().addOpening(wallIds()[0]!, 'back-door');
    const [opening] = houseNow().openings;

    store().setOpeningSwing(opening!.id, 'outward');

    expect(houseNow().openings[0]!.swing).toBe('outward');
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

describe('the property: gates, the street and what each side is made of', () => {
  /** The vertex the nth edge starts at — what the store keys everything on. */
  const edgeId = (index: number) => store().present.vertices[index]!.id;

  /** Places a gate `offset` metres along the nth side, as clicking that side does. */
  const gateOn = (index: number, offset: number) =>
    store().addGate(edgeId(index), 'pedestrian', offset);

  beforeEach(() => {
    drawPlot();
    placeHouse();
  });

  it('lands the user in Select once the house is placed', () => {
    // Every next move — drag the house, click a wall, click a side — is a selection.
    expect(store().mode).toBe('select');
    expect(store().selection).toEqual({ kind: 'house' });
  });

  it('places a gate on the side asked for, measured from its start corner', () => {
    // Edge 1 runs v2 (20,0) → v3 (20,16); six metres down it.
    gateOn(1, 6);

    const [gate] = store().present.gates;
    expect(gate?.edgeVertexId).toBe(edgeId(1));
    expect(gate?.offsetAlongEdge).toBeCloseTo(6);
    expect(gate?.width).toBeCloseTo(0.9);
    expect(gate?.kind).toBe('pedestrian');
    // Selected on arrival, so its side's editor opens with it expanded.
    expect(store().selection).toEqual({ kind: 'gate', id: gate!.id });
  });

  it('puts a gate at the first place it fits when no offset is given', () => {
    store().addGate(edgeId(1));

    // Centre first, which is where a person would put a single gate.
    expect(store().present.gates[0]?.offsetAlongEdge).toBeCloseTo(8);
  });

  it('gives a driveway its own width, and a car’s worth of it', () => {
    store().addGate(edgeId(0), 'vehicle');

    const [gate] = store().present.gates;
    expect(gate?.kind).toBe('vehicle');
    expect(gate?.width).toBeCloseTo(3);
  });

  it('carries an untyped width with the kind, and keeps a typed one', () => {
    store().addGate(edgeId(1), 'pedestrian', 6);
    const [gate] = store().present.gates;

    store().setGateKind(gate!.id, 'vehicle');
    expect(store().present.gates[0]!.width).toBeCloseTo(3);

    store().setGateWidth(gate!.id, 2.2);
    store().setGateKind(gate!.id, 'pedestrian');
    // Typed, so it survives — the user said 2.2 m and nothing here knows better.
    expect(store().present.gates[0]!.width).toBeCloseTo(2.2);
  });

  it('refuses a width below what a person fits through', () => {
    gateOn(1, 6);
    const [gate] = store().present.gates;

    store().setGateWidth(gate!.id, 0.2);

    expect(store().present.gates[0]!.width).toBeCloseTo(0.9);
  });

  it('slides a gate along its side, clamped to stay on it', () => {
    gateOn(1, 6);
    const [gate] = store().present.gates;

    store().setGateOffset(gate!.id, 99);

    // A 0.9 m gate on a 16 m side stops with its edge against the corner.
    expect(store().present.gates[0]!.offsetAlongEdge).toBeCloseTo(15.55);
  });

  it('refuses a gate through another gate, and keeps the history clean', () => {
    gateOn(1, 6);
    const before = store().past.length;
    gateOn(1, 6.3);

    expect(store().present.gates).toHaveLength(1);
    expect(store().past.length).toBe(before);
  });

  it('says what each side is made of, and how tall it stands', () => {
    const side = edgeId(0);
    store().setBoundaryKind(side, 'wall');
    expect(kindForEdge(store().present, side)).toBe('wall');

    store().setBoundaryHeight(side, 2.4);
    expect(boundaryRuns(store().present)[0]!.height).toBeCloseTo(2.4);

    // A typed height is a fact about that side, not about its kind, so it survives the change.
    store().setBoundaryKind(side, 'hedge');
    expect(boundaryRuns(store().present)[0]!.height).toBeCloseTo(2.4);

    // Back to the kind's own default, which stores nothing rather than a number.
    store().setBoundaryHeight(side, null);
    expect(boundaryRuns(store().present)[0]!.height).toBeCloseTo(BOUNDARY_HEIGHTS.hedge);
  });

  it('keeps a no-op tap on a side out of the undo history', () => {
    const side = edgeId(0);
    store().setBoundaryKind(side, 'wall');
    const depth = store().past.length;

    store().setBoundaryKind(side, 'wall');
    store().setBoundaryHeight(side, null);

    expect(store().past.length).toBe(depth);
  });

  it('takes the suggested gate on the wider return, behind the back wall', () => {
    store().addSuggestedGate();
    const [gate] = store().present.gates;
    expect(gate).toBeDefined();
    // House 8 wide at x 10: both returns are 6 m; a tie goes to the first side fence found.
    expect(['v2', 'v4']).toContain(gate!.edgeVertexId);
  });

  it('removes a gate, and undo brings it back', () => {
    gateOn(1, 6);
    const [gate] = store().present.gates;
    store().removeGate(gate!.id);
    expect(store().present.gates).toHaveLength(0);
    store().undo();
    expect(store().present.gates).toHaveLength(1);
  });

  it('re-homes a gate when a corner is inserted before it on its edge', () => {
    gateOn(1, 10);
    store().insertVertexOnEdge(1, { x: 20, y: 4 });

    const [gate] = store().present.gates;
    const inserted = store().present.vertices[2]!;
    expect(gate?.edgeVertexId).toBe(inserted.id);
    expect(gate?.offsetAlongEdge).toBeCloseTo(6);
  });

  it('keeps a gate where it was when a redundant corner on its side is deleted', () => {
    // The corner at (20, 8) sits on the straight right-hand side; taking it out leaves the side
    // exactly where it was, so the gate at (20, 12) has no reason to go anywhere.
    store().insertVertexOnEdge(1, { x: 20, y: 8 });
    store().addGate(edgeId(2), 'pedestrian', 4);
    const corner = store().present.vertices[2]!;
    expect(store().present.gates[0]?.edgeVertexId).toBe(corner.id);

    store().deleteVertex(corner.id);

    const [gate] = store().present.gates;
    expect(gate?.edgeVertexId).toBe(store().present.vertices[1]!.id);
    expect(gate?.offsetAlongEdge).toBeCloseTo(12);
    expect(gateCentre(store().present, gate!)).toEqual({ x: 20, y: 12 });
  });

  it('drops a gate when the corner its side turned on is deleted', () => {
    // A real bend: the corner sticks out to (24, 8). The straight side that replaces the two
    // bent ones does not pass through the gate, and there is nowhere honest to put it.
    store().insertVertexOnEdge(1, { x: 24, y: 8 });
    store().addGate(edgeId(2), 'pedestrian', 4);
    const corner = store().present.vertices[2]!;
    expect(store().present.gates).toHaveLength(1);

    store().deleteVertex(corner.id);
    expect(store().present.gates).toHaveLength(0);
  });

  it('nudges a gate whole onto one half when a corner is inserted through it', () => {
    gateOn(1, 10);
    store().insertVertexOnEdge(1, { x: 20, y: 10.2 });

    const [gate] = store().present.gates;
    // Centre 10 is before the cut at 10.2, so the first half keeps it — clamped flush to the
    // new corner rather than left straddling it.
    expect(gate?.edgeVertexId).toBe(store().present.vertices[1]!.id);
    expect(gate?.offsetAlongEdge).toBeCloseTo(10.2 - 0.45);
    expect(fitsOnEdge(store().present, gate!)).toBe(true);
  });

  it('gives both halves of a split side the side’s kind', () => {
    const side = store().present.vertices[1]!;
    store().setBoundaryKind(side.id, 'hedge');
    store().insertVertexOnEdge(1, { x: 20, y: 8 });

    const inserted = store().present.vertices[2]!;
    expect(kindForEdge(store().present, side.id)).toBe('hedge');
    expect(kindForEdge(store().present, inserted.id)).toBe('hedge');
  });

  it('keeps a gate the same distance from corner A when the closing edge is shortened', () => {
    // The closing edge runs v4 (0,16) → v1 (0,0); a gate 4 m from A is 12 m from v4. Editing that
    // side moves v4, so the stored offset has to move with it or the gate slides up the fence.
    store().addGate(edgeId(3), 'pedestrian', 12);
    store().setEdgeLength(3, 8);

    const [gate] = store().present.gates;
    expect(store().present.vertices[3]).toMatchObject({ x: 0, y: 8 });
    expect(gate?.offsetAlongEdge).toBeCloseTo(4);
    expect(gateCentre(store().present, gate!)).toEqual({ x: 0, y: 4 });
  });

  it('scales a gate along its fence with the plot, and keeps its width', () => {
    gateOn(1, 6);
    store().scalePlot(0.1);

    const [gate] = store().present.gates;
    expect(gate?.offsetAlongEdge).toBeCloseTo(0.6);
    expect(gate?.width).toBeCloseTo(0.9);
    expect(gateCentre(store().present, gate!)).not.toBeNull();
  });

  it('sets and clears the street edge, and takes the suggestion', () => {
    store().setStreetEdge(edgeId(2));
    expect(store().present.streetEdgeVertexId).toBe(edgeId(2));
    store().setStreetEdge(null);
    expect(store().present.streetEdgeVertexId).toBeNull();

    store().setSuggestedStreetEdge();
    // The house faces +y, so the street is the bottom fence, v3 → v4.
    expect(store().present.streetEdgeVertexId).toBe(edgeId(2));
  });

  it('moves the street edge onto the merged side when a redundant corner is deleted', () => {
    // The bottom fence still faces the street after the corner in the middle of it goes.
    store().insertVertexOnEdge(2, { x: 10, y: 16 });
    const corner = store().present.vertices[3]!;
    store().setStreetEdge(edgeId(3));
    store().deleteVertex(corner.id);
    expect(store().present.streetEdgeVertexId).toBe(store().present.vertices[2]!.id);
  });

  it('forgets a street edge whose corner was a real bend', () => {
    store().insertVertexOnEdge(2, { x: 10, y: 22 });
    const corner = store().present.vertices[3]!;
    store().setStreetEdge(edgeId(3));
    store().deleteVertex(corner.id);
    expect(store().present.streetEdgeVertexId).toBeNull();
  });

  it('forgets a gate that has been removed, so the panel is never about nothing', () => {
    gateOn(1, 6);
    const [gate] = store().present.gates;
    expect(store().selection).toEqual({ kind: 'gate', id: gate!.id });

    store().removeGate(gate!.id);

    expect(store().selection).toBeNull();
  });

  it('resolves the side of a selected gate, so the plan and the panel agree', () => {
    gateOn(1, 6);
    expect(selectedEdgeVertexId(store())).toBe(edgeId(1));

    store().select({ kind: 'edge', edgeVertexId: edgeId(0) });
    expect(selectedEdgeVertexId(store())).toBe(edgeId(0));
  });

  it('leaves a gate off its side rather than moving it, and can fit it back on', () => {
    gateOn(1, 14);
    const [gate] = store().present.gates;
    // The right side runs 16 m; typing it down to 8 leaves the gate hanging off the end.
    store().setEdgeLength(1, 8);
    expect(gateCentre(store().present, store().present.gates[0]!)).toBeNull();
    expect(store().present.gates).toHaveLength(1);

    store().fitGate(gate!.id);

    expect(gateCentre(store().present, store().present.gates[0]!)).not.toBeNull();
  });

  /*
   * The trap `sameGeometry` used to be: it compared vertices and the house outline only, so a
   * gesture that moved nothing else ended on "nothing changed" and left no way to undo it.
   */
  it('earns an undo entry for a gesture that only moved a gate', () => {
    gateOn(1, 6);
    const [gate] = store().present.gates;
    const depth = store().past.length;

    store().beginGesture();
    store().setGateOffset(gate!.id, 9);
    store().endGesture();

    expect(store().past.length).toBeGreaterThan(depth);
    store().undo();
    expect(store().present.gates[0]!.offsetAlongEdge).toBeCloseTo(6);
  });

  it('records no entry for a gesture that ends where it started', () => {
    gateOn(1, 6);
    const depth = store().past.length;

    store().beginGesture();
    store().endGesture();

    expect(store().past.length).toBe(depth);
  });

  describe('dragging on the plan', () => {
    const houseNow = () => store().present.house!;
    const wallOf = (index: number) => houseWalls(houseNow())[index]!.id;

    /*
     * Undoing a drag used to close the panel the drag happened in, because undo cleared the
     * selection outright. The correction then vanished from under the user along with the thing
     * being corrected.
     */
    it('keeps the gate selected through an undo of its own drag', () => {
      gateOn(1, 6);
      const gate = store().present.gates[0]!;

      store().beginGesture();
      store().moveGateLive(gate.id, 9);
      store().endGesture();
      store().undo();

      expect(store().selection).toEqual({ kind: 'gate', id: gate.id });
      expect(store().present.gates[0]!.offsetAlongEdge).toBeCloseTo(6);
    });

    it('lets go of a selection undo has taken away', () => {
      gateOn(1, 6);
      const gate = store().present.gates[0]!;
      store().select({ kind: 'gate', id: gate.id });

      // Undoing the *add* leaves nothing for the panel to be about.
      store().undo();

      expect(store().present.gates).toEqual([]);
      expect(store().selection).toBeNull();
    });

    it('slides a gate with no history of its own, one entry for the gesture', () => {
      gateOn(1, 6);
      const gate = store().present.gates[0]!;
      const depth = store().past.length;

      store().beginGesture();
      store().moveGateLive(gate.id, 7);
      store().moveGateLive(gate.id, 8);
      store().moveGateLive(gate.id, 9);
      expect(store().past.length).toBe(depth);

      store().endGesture();

      expect(store().present.gates[0]!.offsetAlongEdge).toBeCloseTo(9);
      expect(store().past.length).toBe(depth + 1);
    });

    it('keeps a slid gate on its side rather than letting it run off the end', () => {
      gateOn(1, 6);
      const gate = store().present.gates[0]!;

      store().moveGateLive(gate.id, 99);

      // A 0.9 m gate on a 16 m side stops with its edge against the corner.
      expect(store().present.gates[0]!.offsetAlongEdge).toBeCloseTo(15.55);
      expect(gateCentre(store().present, store().present.gates[0]!)).not.toBeNull();
    });

    /*
     * The gesture that distinguishes a resize from a move: the end under the pointer follows it,
     * the other end does not budge.
     */
    it('moves only the end being dragged', () => {
      store().addGate(edgeId(1), 'vehicle', 8);
      const gate = store().present.gates[0]!;
      // 3 m wide centred on 8: from 6.5, to 9.5.

      store().resizeGateLive(gate.id, 'from', 5);

      const resized = store().present.gates[0]!;
      expect(resized.width).toBeCloseTo(4.5);
      expect(resized.offsetAlongEdge).toBeCloseTo(7.25);
      // The far end is exactly where it was.
      expect(resized.offsetAlongEdge + resized.width / 2).toBeCloseTo(9.5);
    });

    it('stops dead at the narrowest a gate can be, rather than vanishing', () => {
      store().addGate(edgeId(1), 'vehicle', 8);
      const gate = store().present.gates[0]!;

      store().resizeGateLive(gate.id, 'from', 9.4);

      // Refused: the last legal width stays on screen.
      expect(store().present.gates[0]!.width).toBeCloseTo(3);
    });

    it('slides a door along its wall and resizes one end of it', () => {
      store().addOpening(wallOf(0), 'patio-door');
      const opening = houseNow().openings[0]!;
      const depth = store().past.length;

      store().beginGesture();
      store().moveOpeningLive(opening.id, 2);
      store().endGesture();

      expect(houseNow().openings[0]!.offsetAlongEdge).toBeCloseTo(2);
      expect(store().past.length).toBe(depth + 1);

      // 2.4 m wide centred on 2: from 0.8, to 3.2. Dragging `to` out to 5 widens it to 4.2.
      store().resizeOpeningLive(opening.id, 'to', 5);
      expect(houseNow().openings[0]!.width).toBeCloseTo(4.2);
      expect(houseNow().openings[0]!.offsetAlongEdge).toBeCloseTo(2.9);
    });

    it('will not drag a door through the one next to it', () => {
      store().addOpening(wallOf(0), 'back-door');
      store().addOpening(wallOf(0), 'window');
      const [door, window] = houseNow().openings;
      const before = houseNow().openings.map((opening) => opening.offsetAlongEdge);

      // Straight at the neighbour: `fitsOnWall` refuses, so the frame is dropped.
      store().moveOpeningLive(window!.id, door!.offsetAlongEdge);

      expect(houseNow().openings.map((opening) => opening.offsetAlongEdge)).toEqual(before);
    });
  });
});

describe('house storeys', () => {
  beforeEach(() => {
    drawPlot();
    placeHouse();
  });

  it('defaults to two, which is the six metres every plan drew with', () => {
    expect(store().present.house!.storeys).toBe(2);
  });

  it('takes one to three and refuses the rest', () => {
    store().setStoreys(1);
    expect(store().present.house!.storeys).toBe(1);

    store().setStoreys(4);
    store().setStoreys(0);
    store().setStoreys(1.5);
    expect(store().present.house!.storeys).toBe(1);
  });

  it('is one undo entry, and a no-op records none', () => {
    const depth = store().past.length;
    store().setStoreys(3);
    expect(store().past.length).toBe(depth + 1);

    store().setStoreys(3);
    expect(store().past.length).toBe(depth + 1);
  });
});
