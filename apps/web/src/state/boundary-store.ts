'use client';

import { create } from 'zustand';
import {
  canWallHold,
  clampOffsetToWall,
  firstFreeOffset,
  fitsOnWall,
  houseWalls,
  OPENING_DEFAULTS,
  SiteLocationSchema,
  SiteSectionSchema,
  SiteSunSchema,
  type Opening,
  type SiteLocation,
  type SiteSun,
  type OpeningType,
  type Point,
  type WallKind,
} from '@garden-studio/schema';
import {
  boundaryEdges,
  draftPolygon,
  edgeLength,
  nextDrawPoint,
  polygonCentroid,
  polygonIsSimple,
  reflowEdge,
  scalePointAbout,
  vertexFromMeasurement,
  type BoundaryDraft,
  type BoundaryVertex,
} from '@/lib/boundary-geometry';
import {
  clampHouseInside,
  houseFitsInside,
  houseFromPoints,
  houseSize,
  moveHouse,
  normaliseDegrees,
  rectangleHouse,
  resizeHouse,
  rotateHouse,
  scaleHouseAbout,
  type HouseFootprint,
  type HouseSize,
} from '@/lib/house';
import { snapCentreToAlignment } from '@/lib/guides';
import { snapPoint } from '@/lib/grid';
import { computeZones, ZONE_ORDER, type GardenZone, type ZoneId } from '@/lib/zones';
import { highestId } from '@/lib/hydration';
import type { Unit } from '@/lib/units';

/** Boundary mode draws the plot; House mode places the building inside it. */
export type EditorMode = 'boundary' | 'house' | 'select' | 'measure';
export type BoundaryTool = 'draw' | 'add-point' | 'move' | 'delete';
export type HouseTool = 'rectangle' | 'custom' | 'move' | 'rotate';

export type Selection = { kind: 'vertex'; id: string } | { kind: 'house' } | null;

/** Clicking this close to the first point closes the polygon, in metres. */
export const CLOSE_DISTANCE = 0.6;

/** A polygon needs three corners; below that there is nothing to enclose. */
const MIN_VERTICES = 3;

/** Deep enough to undo a session's worth of fiddling without unbounded growth. */
const HISTORY_LIMIT = 50;

let vertexCounter = 0;
function nextVertexId(): string {
  vertexCounter += 1;
  return `v${vertexCounter}`;
}

let openingCounter = 0;
function nextOpeningId(): string {
  openingCounter += 1;
  return `o${openingCounter}`;
}

/**
 * Applies a change to one opening and keeps it only if the result still fits its wall.
 *
 * Refusing rather than clamping the *whole* edit is the same courtesy `commitHouse` extends to a
 * resize: an illegal result leaves the last legal one on screen, so the user sees the shape stop
 * rather than jump somewhere they did not ask for. Offsets are clamped before they get here, so
 * what this actually catches is a clash with the opening next door.
 */
function editOpening(
  draft: BoundaryDraft,
  openingId: string,
  mutate: (opening: Opening, house: HouseFootprint) => Opening,
): BoundaryDraft | null {
  const house = draft.house;
  if (!house) return null;

  const current = house.openings.find((opening) => opening.id === openingId);
  if (!current) return null;

  const next = mutate(current, house);
  if (next === current) return null;
  if (!fitsOnWall(house, next)) return null;

  return {
    ...draft,
    house: {
      ...house,
      openings: house.openings.map((opening) => (opening.id === openingId ? next : opening)),
    },
  };
}

/**
 * Parsed from the schema rather than written out here.
 *
 * The literal version was a second copy of the section's defaults, and it drifted the moment the
 * schema grew a field — silently, because a missing key in an object literal is only a type error
 * if something typechecks it, and `vitest` runs through esbuild which does not. Deriving means an
 * empty plan and a stored one can never disagree about what "empty" is.
 */
function initialDraft(): BoundaryDraft {
  return SiteSectionSchema.parse({});
}

interface BoundaryState {
  past: BoundaryDraft[];
  present: BoundaryDraft;
  future: BoundaryDraft[];

  /*
   * Ephemeral. Deliberately outside the history stack: undo should rewind the property, not
   * which tool button was last pressed or which shape happens to be selected.
   */
  mode: EditorMode;
  boundaryTool: BoundaryTool;
  houseTool: HouseTool;
  unit: Unit;
  selection: Selection;
  hoveredEdgeIndex: number | null;
  /** Points clicked so far while drawing a custom house outline. */
  housePoints: Point[];
  /** Snap pointer-driven placement to half-units and to alignment guides. */
  snapEnabled: boolean;
  /** Hold the next side square to the one before it. On by default — most plots have right angles. */
  rightAngleSnap: boolean;
  /**
   * Which side's length field has focus, so the canvas can show the corner that is about to move.
   * Ephemeral: it is a hover state, not a fact about the plot.
   */
  reflowEdgeIndex: number | null;
  /** Draw a real car beside the plot, as something to judge the drawing's scale against. */
  sizeAnchorVisible: boolean;
  /** The measure tool's two clicks. Ephemeral by design — nothing here is persisted. */
  measurement: { from: Point; to: Point | null } | null;
  /** Epoch millis of the last committed change, for the bottom bar's autosave line. */
  lastSavedAt: number;
  gestureSnapshot: BoundaryDraft | null;
  projectName: string;

  addVertexAt: (point: Point) => void;
  /** Places the next corner from a measured length and turn, exactly as typed. */
  addVertexByMeasurement: (distance: number, turnDegrees: number) => void;
  closeShape: () => void;
  insertVertexOnEdge: (edgeIndex: number, point: Point) => void;
  deleteVertex: (id: string) => void;
  setEdgeLength: (edgeIndex: number, metres: number) => void;
  /** Replaces the whole outline and closes it — presets, and their dimension fields. */
  setPlotOutline: (points: Point[]) => void;
  moveVertexLive: (id: string, point: Point) => void;
  nudgeVertex: (id: string, dx: number, dy: number) => void;

  placeHouseRectangle: (centre: Point, width: number, depth: number) => void;
  addHousePoint: (point: Point) => void;
  closeHouseShape: () => void;
  moveHouseLive: (centre: Point) => void;
  resizeHouseLive: (size: Partial<HouseSize>) => void;
  rotateHouseLive: (degrees: number) => void;
  nudgeHouse: (dx: number, dy: number) => void;
  setHouseSize: (size: Partial<HouseSize>) => void;
  setHouseRotation: (degrees: number) => void;
  removeHouse: () => void;

  /* ---- walls and openings, all of them house edits ---- */

  /** Which wall the elevation strip is showing. Ephemeral: it is a view, not a fact about the plot. */
  selectedWallId: string | null;
  selectWall: (wallId: string | null) => void;
  setWallKind: (wallId: string, kind: WallKind) => void;
  /** Places one at the first offset that fits, or does nothing when the wall is full. */
  addOpening: (wallId: string, type: OpeningType) => void;
  moveOpening: (openingId: string, offsetAlongEdge: number) => void;
  setOpeningWidth: (openingId: string, width: number) => void;
  setOpeningSill: (openingId: string, sillHeight: number) => void;
  removeOpening: (openingId: string) => void;
  /** Degrees clockwise from screen-up to true north. */
  setOrientation: (degrees: number) => void;
  /**
   * Where the garden is. `null` clears it, which switches every solar claim back off.
   *
   * Setting this is the deliberate act that turns shadows on: `orientation` says which way the
   * plot is turned, but solar altitude is a function of latitude, so no honest sun exists until
   * this is filled in.
   */
  setLocation: (location: SiteLocation | null) => void;
  /** The instant the plan is drawn at: day of the year and minutes after local midnight. */
  setSun: (sun: Partial<SiteSun>) => void;

  toggleZone: (id: ZoneId) => void;
  toggleAllZones: () => void;

  /** Rescales the whole plot about its own centroid — the sanity warning's one-tap fix. */
  scalePlot: (factor: number) => void;

  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  resetDraft: () => void;

  toggleSnap: () => void;
  toggleRightAngle: () => void;
  toggleSizeAnchor: () => void;
  previewEdgeReflow: (edgeIndex: number | null) => void;
  addMeasurePoint: (point: Point) => void;
  trackMeasurePointer: (point: Point) => void;
  clearMeasurement: () => void;

  setMode: (mode: EditorMode) => void;
  setBoundaryTool: (tool: BoundaryTool) => void;
  setHouseTool: (tool: HouseTool) => void;
  setUnit: (unit: Unit) => void;
  select: (selection: Selection) => void;
  hoverEdge: (index: number | null) => void;
  setProjectName: (name: string) => void;
}

export const useBoundaryStore = create<BoundaryState>((set, get) => {
  /** Pushes the current draft onto the undo stack and replaces it with the mutated one. */
  function commit(mutate: (draft: BoundaryDraft) => BoundaryDraft | null) {
    set((state) => {
      const next = mutate(state.present);
      if (!next || next === state.present) return state;

      return {
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: next,
        // Branching off an undone state discards the abandoned future.
        future: [],
        lastSavedAt: Date.now(),
      };
    });
  }

  /** Rounds a pointer position to the snap step, when snapping is on. */
  function snapped(point: Point): Point {
    const state = get();
    return state.snapEnabled ? snapPoint(point, state.unit) : point;
  }

  /**
   * A house change with no history entry, for the frames of a drag. An illegal result is
   * dropped rather than clamped, so the shape simply stops at its last legal size or angle.
   */
  function applyHouseLive(mutate: (house: HouseFootprint) => HouseFootprint) {
    set((state) => {
      if (!state.present.house) return state;

      const next = mutate(state.present.house);
      if (state.present.closed && !houseFitsInside(draftPolygon(state.present), next)) {
        return state;
      }

      return { present: { ...state.present, house: next } };
    });
  }

  /** Applies a house change only if the result still fits inside the plot. */
  function commitHouse(mutate: (house: HouseFootprint, boundary: Point[]) => HouseFootprint) {
    commit((draft) => {
      if (!draft.house) return null;

      const boundary = draftPolygon(draft);
      const next = mutate(draft.house, boundary);

      // A resize or rotation has no meaningful partial version, so an impossible one is
      // refused outright rather than half-applied.
      if (draft.closed && !houseFitsInside(boundary, next)) return null;

      return { ...draft, house: next };
    });
  }

  return {
    past: [],
    present: initialDraft(),
    future: [],

    mode: 'boundary',
    boundaryTool: 'draw',
    houseTool: 'rectangle',
    unit: 'm',
    selection: null,
    hoveredEdgeIndex: null,
    housePoints: [],
    snapEnabled: true,
    rightAngleSnap: true,
    reflowEdgeIndex: null,
    sizeAnchorVisible: true,
    selectedWallId: null,
    measurement: null,
    lastSavedAt: Date.now(),
    gestureSnapshot: null,
    projectName: 'My garden',

    addVertexAt: (raw) => {
      const state = get();
      const { present } = state;
      if (present.closed) return;

      /*
       * Closing is tested against the *raw* pointer, not the snapped result. Right-angle snapping
       * projects the point onto an axis, which can carry it further from corner A than
       * `CLOSE_DISTANCE` — so snapping first would make the polygon refuse to close exactly when
       * the user aimed at the corner to close it.
       */
      const first = present.vertices[0];
      const shouldClose =
        present.vertices.length >= MIN_VERTICES &&
        first !== undefined &&
        Math.hypot(raw.x - first.x, raw.y - first.y) <= CLOSE_DISTANCE;

      if (shouldClose) {
        get().closeShape();
        return;
      }

      const point = nextDrawPoint(present.vertices, raw, {
        gridSnap: state.snapEnabled,
        rightAngle: state.rightAngleSnap,
        unit: state.unit,
      });

      commit((draft) => ({
        ...draft,
        vertices: [...draft.vertices, { id: nextVertexId(), x: point.x, y: point.y }],
      }));
    },

    /*
     * A corner placed by measurement instead of by pointing — how a site is actually surveyed.
     * Deliberately exact: a typed 12.4 m must not be rounded to the snap step, because the user
     * has just told us the real number and the grid is only an aid for the ones they have not.
     */
    addVertexByMeasurement: (distance, turnDegrees) =>
      commit((draft) => {
        if (draft.closed) return null;

        const point = vertexFromMeasurement(draft.vertices, distance, turnDegrees);
        if (!point) return null;

        return {
          ...draft,
          vertices: [...draft.vertices, { id: nextVertexId(), x: point.x, y: point.y }],
        };
      }),

    closeShape: () => {
      const { present } = get();
      if (present.closed || present.vertices.length < MIN_VERTICES) return;

      commit((draft) => ({ ...draft, closed: true }));
      // The plot is enclosed, so the next thing to do is put the house in it.
      set({ mode: 'house', houseTool: 'rectangle', boundaryTool: 'move' });
    },

    insertVertexOnEdge: (edgeIndex, point) =>
      commit((draft) => {
        const vertices = [...draft.vertices];
        vertices.splice(edgeIndex + 1, 0, { id: nextVertexId(), x: point.x, y: point.y });
        // Labels are positional, so everything after the insert reletters for free.
        return { ...draft, vertices };
      }),

    deleteVertex: (id) => {
      commit((draft) => {
        const index = draft.vertices.findIndex((vertex) => vertex.id === id);
        if (index === -1) return null;
        if (draft.closed && draft.vertices.length <= MIN_VERTICES) return null;

        return { ...draft, vertices: draft.vertices.filter((vertex) => vertex.id !== id) };
      });

      const { selection } = get();
      if (selection?.kind === 'vertex' && selection.id === id) set({ selection: null });
    },

    setEdgeLength: (edgeIndex, metres) =>
      commit((draft) => {
        if (!Number.isFinite(metres) || metres <= 0) return null;

        const edge = boundaryEdges(draft.vertices, draft.closed)[edgeIndex];
        // Setting an edge to the length it already has is not an edit, and must not land on
        // the undo stack.
        if (edge && Math.abs(edgeLength(edge.start, edge.end) - metres) < 1e-6) return null;

        const vertices = reflowEdge(draft.vertices, edgeIndex, metres);
        if (vertices === draft.vertices) return null;

        /*
         * Sliding one corner along its edge can walk it straight through the opposite side, and
         * a bow tie has a perfectly ordinary vertex list — the shoelace area comes out quietly
         * wrong and nothing downstream would report it. Refusing the edit leaves the last legal
         * outline on screen, which is the same courtesy `commitHouse` extends to a resize.
         */
        if (draft.closed && !polygonIsSimple(vertices)) return null;

        return { ...draft, vertices };
      }),

    /*
     * Replaces the whole outline — how a preset is applied, and how its dimension fields edit it
     * afterwards. Geometry only: it does not touch the mode, because a keystroke in a width field
     * must not throw the user into house placement the way closing a hand-drawn outline does.
     *
     * Vertex ids are reused positionally when the corner count is unchanged, so retyping a width
     * does not invalidate the selection or every React key on the canvas.
     */
    setPlotOutline: (points) =>
      commit((draft) => {
        if (points.length < MIN_VERTICES || !polygonIsSimple(points)) return null;

        const vertices = points.map((point, index) => ({
          id: draft.vertices[index]?.id ?? nextVertexId(),
          x: point.x,
          y: point.y,
        }));

        return { ...draft, vertices, closed: true };
      }),

    /* Frames of a corner drag: no history, one entry comes from the gesture as a whole. */
    moveVertexLive: (id, raw) =>
      set((state) => {
        const point = state.snapEnabled ? snapPoint(raw, state.unit) : raw;

        return {
          present: {
            ...state.present,
            vertices: state.present.vertices.map((vertex) =>
              vertex.id === id ? { ...vertex, x: point.x, y: point.y } : vertex,
            ),
          },
        };
      }),

    nudgeVertex: (id, dx, dy) =>
      commit((draft) => ({
        ...draft,
        vertices: draft.vertices.map((vertex) =>
          vertex.id === id ? { ...vertex, x: vertex.x + dx, y: vertex.y + dy } : vertex,
        ),
      })),

    placeHouseRectangle: (rawCentre, width, depth) => {
      const centre = snapped(rawCentre);

      commit((draft) => {
        const house = rectangleHouse(centre, width, depth);
        if (draft.closed && !houseFitsInside(draftPolygon(draft), house)) return null;

        // A freshly placed house means freshly computed zones, and the user almost always
        // wants all of them in scope to begin with.
        return { ...draft, house, selectedZoneIds: [...ZONE_ORDER] };
      });

      if (get().present.house) set({ selection: { kind: 'house' }, houseTool: 'move' });
    },

    addHousePoint: (point) =>
      set((state) => ({ housePoints: [...state.housePoints, snapped(point)] })),

    closeHouseShape: () => {
      const { housePoints, present } = get();
      const house = houseFromPoints(housePoints);
      if (!house) return;

      if (present.closed && !houseFitsInside(draftPolygon(present), house)) {
        // Leave the points on screen so the user can see what did not fit.
        return;
      }

      commit((draft) => ({ ...draft, house, selectedZoneIds: [...ZONE_ORDER] }));
      set({ housePoints: [], selection: { kind: 'house' }, houseTool: 'move' });
    },

    /*
     * Dragging slides the house up against the fence rather than refusing to move at all —
     * a shape that freezes mid-drag reads as a broken canvas.
     */
    moveHouseLive: (rawCentre) =>
      set((state) => {
        if (!state.present.house) return state;

        const boundary = draftPolygon(state.present);

        /*
         * Grid first, then alignment: alignment wins where both apply, because lining a wall
         * up with a fence is a stronger intent than landing on a half-metre.
         */
        let centre = rawCentre;
        if (state.snapEnabled) {
          centre = snapPoint(centre, state.unit);
          centre = snapCentreToAlignment(boundary, state.present.house, centre);
        }

        const house = state.present.closed
          ? clampHouseInside(boundary, state.present.house, centre)
          : moveHouse(state.present.house, centre);

        return { present: { ...state.present, house } };
      }),

    /*
     * Live variants for dragging a corner or the rotation handle. They skip history — one
     * entry per gesture comes from beginGesture/endGesture — and silently ignore a value
     * that would put the house through a fence, so the shape stops at the last legal size
     * rather than jumping.
     */
    resizeHouseLive: (size) => applyHouseLive((house) => resizeHouse(house, size)),
    rotateHouseLive: (degrees) => applyHouseLive((house) => rotateHouse(house, degrees)),

    nudgeHouse: (dx, dy) =>
      commitHouse((house) => moveHouse(house, { x: house.centre.x + dx, y: house.centre.y + dy })),

    setHouseSize: (size) => commitHouse((house) => resizeHouse(house, size)),

    setHouseRotation: (degrees) => {
      if (!Number.isFinite(degrees)) return;
      commitHouse((house) => rotateHouse(house, degrees));
    },

    removeHouse: () => {
      commit((draft) => (draft.house ? { ...draft, house: null, selectedZoneIds: [] } : null));
      set({ selection: null, housePoints: [] });
    },

    /*
     * ---- walls and openings ----
     *
     * Every one of these is a plain house edit, deliberately *not* routed through `commitHouse`:
     * that guard exists to stop a resize or a rotation pushing the building through the fence, and
     * none of these move the footprint at all. Legality here is about the wall — will it take this
     * sort of opening, does the opening fit, does it clash with another — and that decision lives
     * in `fitsOnWall` so the same rule applies wherever an opening comes from.
     */

    selectWall: (selectedWallId) => set({ selectedWallId }),

    setWallKind: (wallId, kind) =>
      commit((draft) => {
        if (!draft.house) return null;

        const walls = houseWalls(draft.house).map((wall) =>
          wall.id === wallId ? { ...wall, kind } : wall,
        );

        /*
         * Reclassifying a wall can invalidate what is already on it — a party wall holds nothing,
         * an attached garage holds only a garage door. Those openings are *removed* rather than
         * kept and hidden: leaving a door on a party wall would have the generator design a path to
         * a doorway into next door's kitchen.
         */
        const openings = draft.house.openings.filter(
          (opening) => opening.wallId !== wallId || canWallHold(kind, opening.type),
        );

        return { ...draft, house: { ...draft.house, walls, openings } };
      }),

    addOpening: (wallId, type) =>
      commit((draft) => {
        if (!draft.house) return null;

        const wall = houseWalls(draft.house).find((entry) => entry.id === wallId);
        if (!wall || !canWallHold(wall.kind, type)) return null;

        const candidate = {
          ...OPENING_DEFAULTS[type],
          id: nextOpeningId(),
          wallId,
          offsetAlongEdge: 0,
        };

        const offsetAlongEdge = firstFreeOffset(draft.house, wallId, candidate);
        if (offsetAlongEdge === null) return null;

        return {
          ...draft,
          house: {
            ...draft.house,
            openings: [...draft.house.openings, { ...candidate, offsetAlongEdge }],
          },
        };
      }),

    moveOpening: (openingId, offsetAlongEdge) =>
      commit((draft) =>
        editOpening(draft, openingId, (opening, house) => ({
          ...opening,
          offsetAlongEdge:
            clampOffsetToWall(house, opening.wallId, opening.width, offsetAlongEdge) ??
            opening.offsetAlongEdge,
        })),
      ),

    setOpeningWidth: (openingId, width) =>
      commit((draft) =>
        editOpening(draft, openingId, (opening, house) => {
          if (!(width > 0)) return opening;

          // Widening can push it off the end, so the offset is re-clamped for the new width.
          const offsetAlongEdge =
            clampOffsetToWall(house, opening.wallId, width, opening.offsetAlongEdge) ??
            opening.offsetAlongEdge;

          return { ...opening, width, offsetAlongEdge };
        }),
      ),

    setOpeningSill: (openingId, sillHeight) =>
      commit((draft) =>
        editOpening(draft, openingId, (opening) =>
          sillHeight >= 0 ? { ...opening, sillHeight } : opening,
        ),
      ),

    removeOpening: (openingId) =>
      commit((draft) =>
        draft.house
          ? {
              ...draft,
              house: {
                ...draft.house,
                openings: draft.house.openings.filter((opening) => opening.id !== openingId),
              },
            }
          : null,
      ),

    setOrientation: (degrees) =>
      commit((draft) =>
        Number.isFinite(degrees) ? { ...draft, orientation: normaliseDegrees(degrees) } : null,
      ),

    setLocation: (location) =>
      commit((draft) => {
        if (location === null) return { ...draft, location: null };

        // Refused rather than clamped. A latitude of 91 is not a garden slightly too far north,
        // it is a bad reading — and silently moving it to 90 would draw a plausible arctic sun
        // over whatever the user actually meant.
        const parsed = SiteLocationSchema.safeParse(location);
        return parsed.success ? { ...draft, location: parsed.data } : null;
      }),

    setSun: (sun) =>
      commit((draft) => {
        const parsed = SiteSunSchema.safeParse({ ...draft.sun, ...sun });
        return parsed.success ? { ...draft, sun: parsed.data } : null;
      }),

    toggleZone: (id) =>
      commit((draft) => ({
        ...draft,
        selectedZoneIds: draft.selectedZoneIds.includes(id)
          ? draft.selectedZoneIds.filter((zoneId) => zoneId !== id)
          : [...draft.selectedZoneIds, id],
      })),

    toggleAllZones: () =>
      commit((draft) => {
        const available = computeZones(draftPolygon(draft), draft.house).map((zone) => zone.id);
        const allSelected = available.every((id) => draft.selectedZoneIds.includes(id));

        return { ...draft, selectedZoneIds: allSelected ? [] : available };
      }),

    /*
     * The whole plot rescaled about its own centroid, one undo entry, geometry only.
     *
     * The house has to travel with it — outline as well as centre, which is what
     * `scaleHouseAbout` is for. Scaling the plot and leaving a full-size building standing in it
     * makes the house stop fitting, and every later house edit is then refused by `commitHouse`
     * for a reason the user cannot see.
     *
     * `selectedZoneIds` is untouched, which is the point: zones are derived, and the ticks are the
     * only part the document keeps. A rescale does not preserve them — `MIN_ZONE_AREA` is an
     * absolute 0.5 m², so dividing every length by ten divides every zone area by a hundred and a
     * narrow side return can fall below the sliver threshold. Keeping the ticks is exactly what
     * `effectiveZoneIds` was built for: the choice survives in the document and comes back if the
     * zone does.
     */
    scalePlot: (factor) =>
      commit((draft) => {
        if (draft.vertices.length < MIN_VERTICES || !(factor > 0)) return null;

        const centre = polygonCentroid(draftPolygon(draft));

        return {
          ...draft,
          vertices: draft.vertices.map((vertex) => ({
            ...vertex,
            ...scalePointAbout(vertex, centre, factor),
          })),
          house: draft.house ? scaleHouseAbout(draft.house, centre, factor) : null,
        };
      }),

    /*
     * A drag fires dozens of move events. Snapshotting on drag start and only folding that
     * snapshot into history on drag end keeps one undo entry per gesture — and none at all
     * if the shape ends up back where it started.
     */
    beginGesture: () => set((state) => ({ gestureSnapshot: state.present })),

    endGesture: () =>
      set((state) => {
        const snapshot = state.gestureSnapshot;
        if (!snapshot) return { gestureSnapshot: null };
        if (sameGeometry(snapshot, state.present)) return { gestureSnapshot: null };

        return {
          gestureSnapshot: null,
          past: [...state.past, snapshot].slice(-HISTORY_LIMIT),
          future: [],
          lastSavedAt: Date.now(),
        };
      }),

    undo: () =>
      set((state) => {
        const previous = state.past.at(-1);
        if (!previous) return state;

        return {
          past: state.past.slice(0, -1),
          present: previous,
          future: [state.present, ...state.future],
          selection: null,
        };
      }),

    redo: () =>
      set((state) => {
        const [next, ...rest] = state.future;
        if (!next) return state;

        return {
          past: [...state.past, state.present],
          present: next,
          future: rest,
          selection: null,
        };
      }),

    resetDraft: () =>
      set((state) => ({
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: initialDraft(),
        future: [],
        mode: 'boundary',
        boundaryTool: 'draw',
        houseTool: 'rectangle',
        selection: null,
        hoveredEdgeIndex: null,
        housePoints: [],
        measurement: null,
        lastSavedAt: Date.now(),
      })),

    toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),

    toggleRightAngle: () => set((state) => ({ rightAngleSnap: !state.rightAngleSnap })),

    toggleSizeAnchor: () => set((state) => ({ sizeAnchorVisible: !state.sizeAnchorVisible })),

    previewEdgeReflow: (reflowEdgeIndex) => set({ reflowEdgeIndex }),

    /** First click anchors the tape, the second fixes the far end; a third starts over. */
    addMeasurePoint: (point) =>
      set((state) => {
        if (!state.measurement || state.measurement.to) {
          return { measurement: { from: point, to: null } };
        }

        return { measurement: { ...state.measurement, to: point } };
      }),

    trackMeasurePointer: (point) =>
      set((state) =>
        state.measurement && !state.measurement.to
          ? { measurement: { ...state.measurement, to: point } }
          : state,
      ),

    clearMeasurement: () => set({ measurement: null }),

    setMode: (mode) =>
      set((state) => {
        // Nothing to put a house inside of until the plot is enclosed.
        if (mode === 'house' && !state.present.closed) return state;

        return {
          mode,
          housePoints: [],
          // Leaving measure mode throws the tape away — it was never meant to persist.
          measurement: null,
          selection: mode === 'house' && state.present.house ? { kind: 'house' } : null,
        };
      }),

    setBoundaryTool: (boundaryTool) => set({ mode: 'boundary', boundaryTool, measurement: null }),
    setHouseTool: (houseTool) => set({ houseTool, housePoints: [] }),
    setUnit: (unit) => set({ unit }),
    select: (selection) => set({ selection }),
    hoverEdge: (hoveredEdgeIndex) => set({ hoveredEdgeIndex }),
    setProjectName: (projectName) => set({ projectName }),
  };
});

/** Whether two drafts describe the same shapes — the test a drag uses to earn a history entry. */
function sameGeometry(a: BoundaryDraft, b: BoundaryDraft): boolean {
  if (a.vertices.length !== b.vertices.length) return false;
  if (
    a.vertices.some((vertex, i) => vertex.x !== b.vertices[i].x || vertex.y !== b.vertices[i].y)
  ) {
    return false;
  }

  if (!a.house || !b.house) return a.house === b.house;
  if (a.house.centre.x !== b.house.centre.x || a.house.centre.y !== b.house.centre.y) return false;
  if (a.house.rotation !== b.house.rotation) return false;
  if (a.house.outline.length !== b.house.outline.length) return false;

  return a.house.outline.every(
    (point, i) => point.x === b.house!.outline[i].x && point.y === b.house!.outline[i].y,
  );
}

/**
 * Everything outside the stored document: tool selection, what is highlighted, the tape
 * measure. A load starts from these rather than keeping whatever the last session was doing.
 */
function ephemeralState() {
  return {
    past: [] as BoundaryDraft[],
    future: [] as BoundaryDraft[],
    mode: 'boundary' as EditorMode,
    boundaryTool: 'draw' as BoundaryTool,
    houseTool: 'rectangle' as HouseTool,
    selection: null as Selection,
    hoveredEdgeIndex: null,
    housePoints: [] as Point[],
    snapEnabled: true,
    rightAngleSnap: true,
    reflowEdgeIndex: null as number | null,
    sizeAnchorVisible: true,
    selectedWallId: null as string | null,
    measurement: null,
    gestureSnapshot: null as BoundaryDraft | null,
  };
}

/** Test hook: the store is a module singleton, so suites must reset it between cases. */
export function resetBoundaryStoreForTests(): void {
  vertexCounter = 0;
  openingCounter = 0;

  useBoundaryStore.setState({
    ...ephemeralState(),
    present: initialDraft(),
    unit: 'm',
    lastSavedAt: Date.now(),
    projectName: 'My garden',
  });
}

/**
 * Loads a stored plan into the editor.
 *
 * The undo stack is deliberately *not* restored. It is up to fifty full drafts of state whose
 * only consumer is the current session, and a redo stack rebuilt after a reload would let the
 * user redo into geometry the server never validated. `canUndo` therefore reads false straight
 * after a load, which the toolbars already handle.
 *
 * `vertexCounter` and `openingCounter` are re-seeded here — see `highestId`. Miss either and the
 * next thing the user adds after a reload takes an id that is already in use, which shows up as two
 * corners moving as one.
 */
export function hydrateBoundaryStore(
  site: BoundaryDraft,
  unit: Unit,
  projectName: string,
  savedAt: number,
): void {
  vertexCounter = highestId(
    site.vertices.map((vertex) => vertex.id),
    /^v(\d+)$/,
  );

  openingCounter = highestId(
    (site.house?.openings ?? []).map((opening) => opening.id),
    /^o(\d+)$/,
  );

  useBoundaryStore.setState({
    ...ephemeralState(),
    present: site,
    unit,
    projectName,
    lastSavedAt: savedAt,
  });
}

/* Derived reads. Zones are recomputed rather than stored, so they can never go stale. */

export function selectZones(state: { present: BoundaryDraft }): GardenZone[] {
  return computeZones(draftPolygon(state.present), state.present.house);
}

/**
 * The design scope, filtered to zones that actually exist. Moving the house can dissolve a
 * zone; the tick stays in the draft so it comes back if the house moves away again, but it
 * must not be reported as selected in the meantime.
 */
export function effectiveZoneIds(draft: BoundaryDraft, zones: GardenZone[]): ZoneId[] {
  return zones.filter((zone) => draft.selectedZoneIds.includes(zone.id)).map((zone) => zone.id);
}

export { houseSize, normaliseDegrees };
export type { BoundaryDraft, BoundaryVertex, GardenZone, HouseFootprint, ZoneId };
