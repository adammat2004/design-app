'use client';

import { create } from 'zustand';
import {
  accessAfterDelete,
  canWallHold,
  clampOffsetToEdge,
  clampOffsetToWall,
  firstFreeOffset,
  firstFreeOffsetOnEdge,
  fitsOnEdge,
  fitsOnWall,
  GATE_DEFAULT_WIDTH,
  GATE_DEFAULTS,
  gateEdge,
  gatesAfterSplit,
  houseWalls,
  inheritBoundaryStyle,
  MIN_GATE_WIDTH,
  MIN_OPENING_WIDTH,
  offsetFromEndPreserved,
  spanFromDraggedEnd,
  wallLength,
  type SpanEnd,
  scaleOffsets,
  styleForEdge,
  suggestedGateEdge,
  kindForEdge,
  type BoundaryKind,
  type GateKind,
  pruneBoundaryStyles,
  setBoundaryStyle,
  suggestedStreetEdge,
  OPENING_DEFAULTS,
  scopeRing,
  SiteLocationSchema,
  SiteSectionSchema,
  SiteSunSchema,
  type Gate,
  type Opening,
  type SiteLocation,
  type SiteSun,
  type OpeningType,
  type Point,
  type Swing,
  type WallKind,
} from '@garden-studio/schema';
import {
  boundaryEdges,
  draftPolygon,
  edgeLength,
  edgeReflowTargets,
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
  clampHouseSize,
  houseFitsInside,
  houseFromPoints,
  houseSize,
  moveHouse,
  normaliseDegrees,
  rectangleHouse,
  resizeHouse,
  rotateHouse,
  scaleHouseAbout,
  shrinkHouseToFit,
  type HouseFootprint,
  type HouseSize,
} from '@/lib/house';
import { snapCentreToAlignment } from '@/lib/guides';
import { snapPoint } from '@/lib/grid';
import { computeZones, ZONE_ORDER, type GardenZone, type ZoneId } from '@/lib/zones';
import { highestId } from '@/lib/hydration';
import type { Unit } from '@/lib/units';

/**
 * Boundary mode draws the plot and House mode places the building inside it — the two creation
 * modes, whose empty-canvas gestures (click to drop a corner, drag out a rectangle) are what
 * stop them being folded into Select. Select is where the property is *described*: every side,
 * wall, gate and door is clickable there, and it is the mode a placed house lands the user in.
 *
 * There used to be a fourth, Access, with a one-shot tool armed from a panel to click a fence
 * for a gate or the street. Everything it did is a property of a side, and a side is a thing you
 * select — so it went, and its chips became `SuggestionsRow`.
 */
export type EditorMode = 'boundary' | 'house' | 'select' | 'measure';

export type BoundaryTool = 'draw' | 'add-point' | 'move' | 'delete';
export type HouseTool = 'rectangle' | 'custom' | 'move' | 'rotate';

/**
 * What the inspector is about. A side is named by the vertex its edge starts at and a wall by its
 * id, for the reason gates and openings are keyed that way: an index goes stale the moment a
 * corner is inserted, an id does not. A gate or an opening selected on its own still shows its
 * parent's editor, with that entry expanded.
 */
export type Selection =
  | { kind: 'vertex'; id: string }
  | { kind: 'house' }
  | { kind: 'edge'; edgeVertexId: string }
  | { kind: 'wall'; wallId: string }
  | { kind: 'gate'; id: string }
  | { kind: 'opening'; id: string }
  | null;

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

let gateCounter = 0;
function nextGateId(): string {
  gateCounter += 1;
  return `g${gateCounter}`;
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

/** The boundary twin of `editOpening`: a gate edit is kept only if the gate still fits its side. */
function editGate(
  draft: BoundaryDraft,
  gateId: string,
  mutate: (gate: Gate, draft: BoundaryDraft) => Gate,
): BoundaryDraft | null {
  const current = draft.gates.find((gate) => gate.id === gateId);
  if (!current) return null;

  const next = mutate(current, draft);
  if (next === current) return null;
  if (!fitsOnEdge(draft, next)) return null;

  return { ...draft, gates: draft.gates.map((gate) => (gate.id === gateId ? next : gate)) };
}

/**
 * Whether what is selected still exists in this draft.
 *
 * Deleting a corner takes its side with it, reclassifying a wall can remove the door that was
 * selected on it, and a removed gate is gone: an inspector left open on any of them would be a
 * panel about nothing. Checked after the commits that can remove things, never inside them —
 * selection is ephemeral and must not ride along in the history.
 */
function selectionExists(selection: Selection, draft: BoundaryDraft): boolean {
  switch (selection?.kind) {
    case undefined:
      return true;
    case 'vertex':
    case 'edge':
      return draft.vertices.some(
        (vertex) =>
          vertex.id === (selection.kind === 'vertex' ? selection.id : selection.edgeVertexId),
      );
    case 'house':
      return draft.house !== null;
    case 'wall':
      return (
        draft.house !== null && houseWalls(draft.house).some((wall) => wall.id === selection.wallId)
      );
    case 'gate':
      return draft.gates.some((gate) => gate.id === selection.id);
    case 'opening':
      return draft.house?.openings.some((opening) => opening.id === selection.id) ?? false;
  }
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
  /** One to three. The one vertical fact about the building — see `HouseFootprint.storeys`. */
  setStoreys: (storeys: number) => void;
  removeHouse: () => void;

  /* ---- walls and openings, all of them house edits ---- */

  /** Selects a wall (or clears the selection): `selection = { kind: 'wall' }`, kept as a verb. */
  selectWall: (wallId: string | null) => void;
  setWallKind: (wallId: string, kind: WallKind) => void;
  /** Places one at the first offset that fits and selects it, or does nothing when the wall is full. */
  addOpening: (wallId: string, type: OpeningType) => void;
  moveOpening: (openingId: string, offsetAlongEdge: number) => void;
  setOpeningWidth: (openingId: string, width: number) => void;
  setOpeningSill: (openingId: string, sillHeight: number) => void;
  /** Frames of a drag along the wall, on the plan or on the strip. */
  moveOpeningLive: (openingId: string, offsetAlongEdge: number) => void;
  resizeOpeningLive: (openingId: string, end: SpanEnd, at: number) => void;
  /** Hinged in, hinged out, or sliding — what decides whether a door sweeps an arc to keep clear. */
  setOpeningSwing: (openingId: string, swing: Swing) => void;
  /** Pulls an opening a resize has pushed off its wall back onto it, where the wall still has room. */
  fitOpening: (openingId: string) => void;
  removeOpening: (openingId: string) => void;

  /* ---- what hangs on the boundary: gates in the fence, the street edge, what each side is ---- */

  /**
   * Adds an opening in this side and selects it. Without an offset it goes at the first place it
   * fits; with one it goes there, clamped onto the side and refused through another gate.
   */
  addGate: (edgeVertexId: string, kind?: GateKind, offsetAlongEdge?: number) => void;
  /** Takes the inferred side gate. Offered, not applied — see `suggestedGateEdge`. */
  addSuggestedGate: () => void;
  setGateKind: (gateId: string, kind: GateKind) => void;
  setGateWidth: (gateId: string, width: number) => void;
  setGateOffset: (gateId: string, offsetAlongEdge: number) => void;
  /**
   * Frames of a drag along the fence: no history, one entry comes from the gesture as a whole.
   * The live/commit pair the house and the corners already use.
   */
  moveGateLive: (gateId: string, offsetAlongEdge: number) => void;
  /** Frames of an end-handle drag: the dragged end follows, the other stays put. */
  resizeGateLive: (gateId: string, end: SpanEnd, at: number) => void;
  /** Pulls a gate a drag has left off its side back onto it, where the side still has room. */
  fitGate: (gateId: string) => void;
  removeGate: (gateId: string) => void;
  /** Which side faces the street, by the vertex its edge starts at; `null` clears it. */
  setStreetEdge: (edgeVertexId: string | null) => void;
  /** What one side of the property is made of. Setting it back to a fence removes the entry. */
  setBoundaryKind: (edgeVertexId: string, kind: BoundaryKind) => void;
  /** How tall that side stands; `null` goes back to the kind's own default. */
  setBoundaryHeight: (edgeVertexId: string, height: number | null) => void;
  setSuggestedStreetEdge: () => void;
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
  /**
   * The custom redesign outline, or `null` to go back to whole zones.
   *
   * Lives here rather than in the features store because it is part of the *site* — it is stored,
   * synced and undone with the boundary and the house, and the generator reads it off
   * `site.scopePolygon`. Step 2 owns the drawing of it; this owns the fact.
   */
  setScopePolygon: (points: Point[] | null) => void;

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
  /** Clears a selection whose target no longer exists. Called after anything that removes things. */
  reconcileSelection: () => void;
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
   *
   * `boundary` is null until the plot is closed — there is no fence to be inside of yet, and a
   * half-drawn ring handed to `houseFitsInside` reports every house as illegal.
   */
  function applyHouseLive(
    mutate: (house: HouseFootprint, boundary: Point[] | null) => HouseFootprint,
  ) {
    set((state) => {
      if (!state.present.house) return state;

      const boundary = state.present.closed ? draftPolygon(state.present) : null;
      const next = mutate(state.present.house, boundary);
      if (boundary && !houseFitsInside(boundary, next)) return state;

      return { present: { ...state.present, house: next } };
    });
  }

  /** Applies a house change only if the result still fits inside the plot. */
  function commitHouse(
    mutate: (house: HouseFootprint, boundary: Point[] | null) => HouseFootprint,
  ) {
    commit((draft) => {
      if (!draft.house) return null;

      const boundary = draft.closed ? draftPolygon(draft) : null;
      const next = mutate(draft.house, boundary);

      // A rotation has no meaningful partial version, so an impossible one is refused outright
      // rather than half-applied. A resize clamps instead — see `setHouseSize`.
      if (boundary && !houseFitsInside(boundary, next)) return null;

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
        const start = draft.vertices[edgeIndex];
        const inserted = { id: nextVertexId(), x: point.x, y: point.y };
        vertices.splice(edgeIndex + 1, 0, inserted);

        if (!start) return { ...draft, vertices };

        /*
         * What was hung on the split edge stays where it was in the fence: a gate beyond the new
         * corner is re-homed onto the new edge with its offset measured from that corner, and the
         * side's kind is carried onto both halves. The street edge stays on the first half. Labels
         * are positional, so everything after the insert reletters for free. The rules themselves
         * live in the schema, beside the resolvers they have to agree with.
         */
        const firstHalf = edgeLength(start, point);
        const after = { ...draft, vertices };

        return {
          ...after,
          gates: gatesAfterSplit(after, start.id, inserted.id, firstHalf),
          boundaryStyles: inheritBoundaryStyle(draft.boundaryStyles, start.id, inserted.id),
        };
      }),

    deleteVertex: (id) => {
      commit((draft) => {
        const index = draft.vertices.findIndex((vertex) => vertex.id === id);
        if (index === -1) return null;
        if (draft.closed && draft.vertices.length <= MIN_VERTICES) return null;

        const vertices = draft.vertices.filter((vertex) => vertex.id !== id);
        const after = { ...draft, vertices };

        /*
         * The edge that started at this corner is gone. What was hung on it is carried onto the
         * edge that replaces it where that edge actually passes through it — deleting a redundant
         * corner on a straight side loses nothing — and dropped where the corner was a real bend.
         * The side's kind goes with the edge: left behind, the entry would describe an edge that
         * no longer exists, and because vertex ids come from a counter it could later be claimed
         * by a corner added somewhere else entirely.
         */
        return {
          ...after,
          ...accessAfterDelete(draft, after, id),
          boundaryStyles: pruneBoundaryStyles(draft.boundaryStyles, vertices),
        };
      });

      // The corner is gone, and so is the side that started at it.
      get().reconcileSelection();
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

        /*
         * Every side but one is lengthened from its far end, and a gate's offset — metres from
         * the side's *start* — needs nothing. The closing edge ends on corner A, so it is its start
         * that slides, and a gate measured from that corner would slide with it. Re-measuring from
         * the pinned end keeps the gate where it was hung.
         */
        const targets = edgeReflowTargets(draft.vertices.length, edgeIndex);
        const startMoved = targets !== null && targets.movedIndex === edgeIndex;
        const startVertex = draft.vertices[edgeIndex];
        const gates =
          edge && startVertex && startMoved
            ? draft.gates.map((gate) =>
                gate.edgeVertexId === startVertex.id
                  ? {
                      ...gate,
                      offsetAlongEdge: offsetFromEndPreserved(
                        gate.offsetAlongEdge,
                        edgeLength(edge.start, edge.end),
                        metres,
                      ),
                    }
                  : gate,
              )
            : draft.gates;

        return { ...draft, vertices, gates };
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
        const requested = rectangleHouse(centre, width, depth);
        const boundary = draft.closed ? draftPolygon(draft) : null;

        /*
         * Shrunk to fit rather than refused. The preset is 8 × 6 m and a small plot is a real
         * thing, so returning null here placed nothing at all and said nothing about why — the
         * user clicks, the canvas does not change, and there is no way to learn that the house
         * they asked for was simply too big.
         */
        const house = boundary ? shrinkHouseToFit(boundary, requested) : requested;
        if (!house) return null;

        /*
         * A freshly placed house means freshly computed zones, and the user almost always wants
         * all of them in scope to begin with. The drawn redesign area goes for the same reason and
         * is stronger: it was traced against a garden that no longer exists, and keeping it would
         * clip the design to an outline the user drew around something else.
         */
        return { ...draft, house, selectedZoneIds: [...ZONE_ORDER], scopePolygon: null };
      });

      /*
       * A placed house lands the user in Select, with the house selected: the next things to do —
       * drag it, click a wall for its doors, click a side for its fence — are all selection.
       */
      if (get().present.house) {
        set({ selection: { kind: 'house' }, houseTool: 'move', mode: 'select' });
      }
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

      commit((draft) => ({
        ...draft,
        house,
        selectedZoneIds: [...ZONE_ORDER],
        scopePolygon: null,
      }));
      set({ housePoints: [], selection: { kind: 'house' }, houseTool: 'move', mode: 'select' });
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
     * entry per gesture comes from beginGesture/endGesture.
     *
     * A resize *clamps* rather than refusing, exactly as a drag does: a house can legitimately
     * be the full width of its plot, and a corner that stops a hair short of the fence with no
     * way to close the gap is the same failure as one that freezes mid-drag. Rotation still
     * refuses — there is no meaningful partial angle.
     */
    resizeHouseLive: (size) =>
      applyHouseLive((house, boundary) =>
        boundary ? clampHouseSize(boundary, house, size) : resizeHouse(house, size),
      ),
    rotateHouseLive: (degrees) => applyHouseLive((house) => rotateHouse(house, degrees)),

    nudgeHouse: (dx, dy) =>
      commitHouse((house) => moveHouse(house, { x: house.centre.x + dx, y: house.centre.y + dy })),

    /** Typed width or depth. Clamped for the reason `clampHouseSize` gives. */
    setHouseSize: (size) =>
      commitHouse((house, boundary) =>
        boundary ? clampHouseSize(boundary, house, size) : resizeHouse(house, size),
      ),

    setHouseRotation: (degrees) => {
      if (!Number.isFinite(degrees)) return;
      commitHouse((house) => rotateHouse(house, degrees));
    },

    // A plain house edit, not a `commitHouse` one: the footprint does not move.
    setStoreys: (storeys) =>
      commit((draft) => {
        if (!draft.house || !Number.isInteger(storeys) || storeys < 1 || storeys > 3) return null;
        if (draft.house.storeys === storeys) return null;
        return { ...draft, house: { ...draft.house, storeys } };
      }),

    removeHouse: () => {
      commit((draft) =>
        draft.house ? { ...draft, house: null, selectedZoneIds: [], scopePolygon: null } : null,
      );
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

    selectWall: (wallId) => set({ selection: wallId === null ? null : { kind: 'wall', wallId } }),

    setWallKind: (wallId, kind) => {
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
      });
      // The door that was selected may be one the new kind just removed.
      get().reconcileSelection();
    },

    addOpening: (wallId, type) => {
      let added: string | null = null;

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

        added = candidate.id;
        return {
          ...draft,
          house: {
            ...draft.house,
            openings: [...draft.house.openings, { ...candidate, offsetAlongEdge }],
          },
        };
      });

      // Selected on arrival, so its wall's editor opens with it and the next move is obvious.
      if (added) set({ selection: { kind: 'opening', id: added } });
    },

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

    moveOpeningLive: (openingId, offsetAlongEdge) =>
      set((state) => {
        const next = editOpening(state.present, openingId, (opening, house) => ({
          ...opening,
          offsetAlongEdge:
            clampOffsetToWall(house, opening.wallId, opening.width, offsetAlongEdge) ??
            opening.offsetAlongEdge,
        }));

        return next ? { present: next } : state;
      }),

    resizeOpeningLive: (openingId, end, at) =>
      set((state) => {
        const next = editOpening(state.present, openingId, (opening, house) => {
          const length = wallLength(house, opening.wallId);
          if (length === null) return opening;

          const half = opening.width / 2;
          const resized = spanFromDraggedEnd(
            [opening.offsetAlongEdge - half, opening.offsetAlongEdge + half],
            end,
            at,
            MIN_OPENING_WIDTH,
            length,
          );

          // Field by field, for the reason `resizeGateLive` gives.
          return resized
            ? { ...opening, offsetAlongEdge: resized.offset, width: resized.width }
            : opening;
        });

        return next ? { present: next } : state;
      }),

    setOpeningSwing: (openingId, swing) =>
      commit((draft) =>
        editOpening(draft, openingId, (opening) =>
          opening.swing === swing ? opening : { ...opening, swing },
        ),
      ),

    fitOpening: (openingId) =>
      commit((draft) =>
        editOpening(draft, openingId, (opening, house) => {
          const offsetAlongEdge = clampOffsetToWall(
            house,
            opening.wallId,
            opening.width,
            opening.offsetAlongEdge,
          );
          if (offsetAlongEdge === null || offsetAlongEdge === opening.offsetAlongEdge) {
            return opening;
          }
          return { ...opening, offsetAlongEdge };
        }),
      ),

    removeOpening: (openingId) => {
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
      );
      get().reconcileSelection();
    },

    addGate: (edgeVertexId, kind = 'pedestrian', offsetAlongEdge) => {
      let added: string | null = null;

      commit((draft) => {
        if (!draft.closed || !draft.vertices.some((vertex) => vertex.id === edgeVertexId)) {
          return null;
        }

        const candidate: Gate = {
          id: nextGateId(),
          edgeVertexId,
          offsetAlongEdge: 0,
          width: GATE_DEFAULTS[kind].width,
          kind,
        };
        const offset =
          offsetAlongEdge === undefined
            ? firstFreeOffsetOnEdge(draft, edgeVertexId, candidate)
            : clampOffsetToEdge(draft, edgeVertexId, candidate.width, offsetAlongEdge);
        if (offset === null) return null;

        const gate = { ...candidate, offsetAlongEdge: offset };
        // Through another gate is refused outright rather than nudged: two gates a metre apart
        // is a mistake the user should see, not one the store should quietly resolve.
        if (!fitsOnEdge(draft, gate)) return null;

        added = gate.id;
        return { ...draft, gates: [...draft.gates, gate] };
      });

      if (added) set({ selection: { kind: 'gate', id: added } });
    },

    addSuggestedGate: () => {
      let added: string | null = null;

      commit((draft) => {
        const suggestion = suggestedGateEdge(draft);
        if (!suggestion) return null;

        const gate: Gate = {
          id: nextGateId(),
          ...suggestion,
          width: GATE_DEFAULT_WIDTH,
          kind: 'pedestrian',
        };
        if (!fitsOnEdge(draft, gate)) return null;

        added = gate.id;
        return { ...draft, gates: [...draft.gates, gate] };
      });

      if (added) set({ selection: { kind: 'gate', id: added } });
    },

    setGateKind: (gateId, kind) =>
      commit((draft) =>
        editGate(draft, gateId, (gate, site) => {
          if (gate.kind === kind) return gate;

          /*
           * A kind is also a default width — a drive is three metres, a gate under one — and a
           * width the user never typed follows the kind. Re-clamped so widening does not push it
           * off the end of the side.
           */
          const typed = gate.width !== GATE_DEFAULTS[gate.kind].width;
          const width = typed ? gate.width : GATE_DEFAULTS[kind].width;
          const offsetAlongEdge =
            clampOffsetToEdge(site, gate.edgeVertexId, width, gate.offsetAlongEdge) ??
            gate.offsetAlongEdge;

          return { ...gate, kind, width, offsetAlongEdge };
        }),
      ),

    setGateWidth: (gateId, width) =>
      commit((draft) =>
        editGate(draft, gateId, (gate, site) => {
          if (!(width >= MIN_GATE_WIDTH)) return gate;

          const offsetAlongEdge =
            clampOffsetToEdge(site, gate.edgeVertexId, width, gate.offsetAlongEdge) ??
            gate.offsetAlongEdge;

          return { ...gate, width, offsetAlongEdge };
        }),
      ),

    setGateOffset: (gateId, offsetAlongEdge) =>
      commit((draft) =>
        editGate(draft, gateId, (gate, site) => ({
          ...gate,
          offsetAlongEdge:
            clampOffsetToEdge(site, gate.edgeVertexId, gate.width, offsetAlongEdge) ??
            gate.offsetAlongEdge,
        })),
      ),

    moveGateLive: (gateId, offsetAlongEdge) =>
      set((state) => {
        const next = editGate(state.present, gateId, (gate, site) => ({
          ...gate,
          offsetAlongEdge:
            clampOffsetToEdge(site, gate.edgeVertexId, gate.width, offsetAlongEdge) ??
            gate.offsetAlongEdge,
        }));

        return next ? { present: next } : state;
      }),

    resizeGateLive: (gateId, end, at) =>
      set((state) => {
        const next = editGate(state.present, gateId, (gate, site) => {
          const edge = gateEdge(site, gate);
          if (!edge) return gate;

          const half = gate.width / 2;
          const resized = spanFromDraggedEnd(
            [gate.offsetAlongEdge - half, gate.offsetAlongEdge + half],
            end,
            at,
            MIN_GATE_WIDTH,
            edgeLength(edge[0], edge[1]),
          );

          /*
           * Mapped field by field rather than spread. The helper is about spans, so it answers
           * `offset`; a gate stores `offsetAlongEdge`. Spreading set the width, left the position
           * behind and added a stray key — which the tests below caught and nothing else would.
           *
           * Refused rather than clamped: the gate stops dead at its minimum, which is visible.
           */
          return resized
            ? { ...gate, offsetAlongEdge: resized.offset, width: resized.width }
            : gate;
        });

        return next ? { present: next } : state;
      }),

    fitGate: (gateId) =>
      commit((draft) =>
        editGate(draft, gateId, (gate, site) => {
          const offsetAlongEdge = clampOffsetToEdge(
            site,
            gate.edgeVertexId,
            gate.width,
            gate.offsetAlongEdge,
          );
          if (offsetAlongEdge === null || offsetAlongEdge === gate.offsetAlongEdge) return gate;
          return { ...gate, offsetAlongEdge };
        }),
      ),

    removeGate: (gateId) => {
      commit((draft) => {
        if (!draft.gates.some((gate) => gate.id === gateId)) return null;
        return { ...draft, gates: draft.gates.filter((gate) => gate.id !== gateId) };
      });
      get().reconcileSelection();
    },

    setStreetEdge: (edgeVertexId) =>
      commit((draft) => {
        if (edgeVertexId !== null && !draft.vertices.some((vertex) => vertex.id === edgeVertexId)) {
          return null;
        }
        if (edgeVertexId === draft.streetEdgeVertexId) return null;
        return { ...draft, streetEdgeVertexId: edgeVertexId };
      }),

    setBoundaryKind: (edgeVertexId, kind) =>
      commit((draft) => {
        if (!draft.vertices.some((vertex) => vertex.id === edgeVertexId)) return null;
        if (kindForEdge(draft, edgeVertexId) === kind) return null;

        // A typed height is a fact about that side, not about its kind, and survives the change.
        const height = styleForEdge(draft, edgeVertexId)?.height;
        return {
          ...draft,
          boundaryStyles: setBoundaryStyle(draft.boundaryStyles, edgeVertexId, kind, height),
        };
      }),

    setBoundaryHeight: (edgeVertexId, height) =>
      commit((draft) => {
        if (!draft.vertices.some((vertex) => vertex.id === edgeVertexId)) return null;
        if (height !== null && !(height > 0)) return null;

        const current = styleForEdge(draft, edgeVertexId)?.height;
        if ((height ?? undefined) === current) return null;

        return {
          ...draft,
          boundaryStyles: setBoundaryStyle(
            draft.boundaryStyles,
            edgeVertexId,
            kindForEdge(draft, edgeVertexId),
            height ?? undefined,
          ),
        };
      }),

    setSuggestedStreetEdge: () =>
      commit((draft) => {
        const next = suggestedStreetEdge(draft);
        if (!next || next === draft.streetEdgeVertexId) return null;
        return { ...draft, streetEdgeVertexId: next };
      }),

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

    setScopePolygon: (points) =>
      commit((draft) => {
        /*
         * Refused rather than stored when it is not a usable area. `scopeRing` is the one rule —
         * the PostGIS validator and the generator both ask it — so a ring that crosses itself or
         * leaves the fence never reaches the document in the first place.
         */
        if (points !== null && scopeRing({ ...draft, scopePolygon: points }) === null) return null;
        if (points === null && draft.scopePolygon === null) return null;

        return { ...draft, scopePolygon: points };
      }),

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
     *
     * Gate offsets scale with the fence they are measured along (`scaleOffsets` says why widths do
     * not); the house's openings are handled inside `scaleHouseAbout` for the same reason.
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
          gates: scaleOffsets(draft.gates, factor),
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
        if (sameDraft(snapshot, state.present)) return { gestureSnapshot: null };

        return {
          gestureSnapshot: null,
          past: [...state.past, snapshot].slice(-HISTORY_LIMIT),
          future: [],
          lastSavedAt: Date.now(),
        };
      }),

    /*
     * Undo keeps the selection where it can, rather than clearing it outright.
     *
     * Clearing was right while only a corner or the house could be selected: undo usually meant
     * geometry had appeared or gone, so whatever was selected was suspect. It is wrong now that a
     * gate, a door or a side can be selected — undoing a gate drag closed the very panel the user
     * was dragging in, so the correction they had just made vanished from under them along with
     * the thing they were correcting. `reconcileSelection` drops it only if its target genuinely
     * is not in the restored draft.
     */
    undo: () => {
      set((state) => {
        const previous = state.past.at(-1);
        if (!previous) return state;

        return {
          past: state.past.slice(0, -1),
          present: previous,
          future: [state.present, ...state.future],
        };
      });
      get().reconcileSelection();
    },

    redo: () => {
      set((state) => {
        const [next, ...rest] = state.future;
        if (!next) return state;

        return {
          past: [...state.past, state.present],
          present: next,
          future: rest,
        };
      });
      get().reconcileSelection();
    },

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
    reconcileSelection: () =>
      set((state) =>
        selectionExists(state.selection, state.present) ? state : { selection: null },
      ),
    hoverEdge: (hoveredEdgeIndex) => set({ hoveredEdgeIndex }),
    setProjectName: (projectName) => set({ projectName }),
  };
});

/**
 * Whether two drafts describe the same property — the test a drag uses to earn a history entry.
 *
 * Everything a gesture can move is compared, not just the outlines. The first version looked at
 * vertices and the house alone, which was complete while those were the only things that could be
 * dragged; a gate slid along its fence would have ended the gesture on "nothing changed" and left
 * no way to undo it. Anything else a drag might touch has to be added here, or the same thing
 * happens to it.
 */
function sameDraft(a: BoundaryDraft, b: BoundaryDraft): boolean {
  if (a.vertices.length !== b.vertices.length) return false;
  if (
    a.vertices.some((vertex, i) => vertex.x !== b.vertices[i].x || vertex.y !== b.vertices[i].y)
  ) {
    return false;
  }

  if (!sameList(a.gates, b.gates)) return false;
  if (!sameList(a.boundaryStyles, b.boundaryStyles)) return false;
  if (a.streetEdgeVertexId !== b.streetEdgeVertexId) return false;

  if (!a.house || !b.house) return a.house === b.house;
  if (a.house.centre.x !== b.house.centre.x || a.house.centre.y !== b.house.centre.y) return false;
  if (a.house.rotation !== b.house.rotation) return false;
  if (a.house.storeys !== b.house.storeys) return false;
  if (a.house.outline.length !== b.house.outline.length) return false;
  if (!sameList(a.house.walls, b.house.walls)) return false;
  if (!sameList(a.house.openings, b.house.openings)) return false;

  return a.house.outline.every(
    (point, i) => point.x === b.house!.outline[i].x && point.y === b.house!.outline[i].y,
  );
}

/**
 * Element-wise value equality for the small records hung on the property. A false negative here
 * costs one spare history entry; a false positive loses an edit, so the comparison is by value.
 */
function sameList<T>(a: T[], b: T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, i) => JSON.stringify(item) === JSON.stringify(b[i]));
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
    measurement: null,
    gestureSnapshot: null as BoundaryDraft | null,
  };
}

/* ---- what is selected, resolved ---- */

/**
 * The wall the wall editor is about: a selected wall, or the wall of a selected opening. A gate or
 * an opening selected on its own still shows its parent's editor, with that entry expanded.
 */
export function selectedWallId(state: {
  selection: Selection;
  present: BoundaryDraft;
}): string | null {
  const { selection, present } = state;
  if (selection?.kind === 'wall') return selection.wallId;
  if (selection?.kind === 'opening') {
    return present.house?.openings.find((opening) => opening.id === selection.id)?.wallId ?? null;
  }
  return null;
}

/** The side the side editor is about: a selected side, or the side of a selected gate. */
export function selectedEdgeVertexId(state: {
  selection: Selection;
  present: BoundaryDraft;
}): string | null {
  const { selection, present } = state;
  if (selection?.kind === 'edge') return selection.edgeVertexId;
  if (selection?.kind === 'gate') {
    return present.gates.find((gate) => gate.id === selection.id)?.edgeVertexId ?? null;
  }
  return null;
}

export function selectedGateId(state: { selection: Selection }): string | null {
  return state.selection?.kind === 'gate' ? state.selection.id : null;
}

export function selectedOpeningId(state: { selection: Selection }): string | null {
  return state.selection?.kind === 'opening' ? state.selection.id : null;
}

/** Test hook: the store is a module singleton, so suites must reset it between cases. */
export function resetBoundaryStoreForTests(): void {
  vertexCounter = 0;
  openingCounter = 0;
  gateCounter = 0;

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

  gateCounter = highestId(
    site.gates.map((gate) => gate.id),
    /^g(\d+)$/,
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
