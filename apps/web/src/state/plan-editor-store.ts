'use client';

import { create } from 'zustand';
import {
  FENCE_REFUSAL,
  lockRefusal,
  boundingBox,
  edgesAfterVertexEdit,
  geometryVertices,
  minimumGeometryVertices,
  rectToPolygon,
  vertexEditRefusal,
  withCornerRadius,
  withGeometryVertices,
  bearingOfElement,
  cornersOf,
  nearestEdgeBearing,
  SNAP_REACH_PX,
  snapPointTo,
  snapShapeDelta,
  snapTargetsFor,
  type PlanSnapTargets,
  SYMBOLS,
  PLANT_CATALOGUE,
  ENCLOSURE_KINDS,
  type EnclosureKind,
  associatePlants,
  isPlantingMix,
  normalisedMix,
  type BedPlanting,
  isPlantSymbol,
  mergeStructureConfig,
  structureDefinitionFor,
  applyStructurePreset,
  clampInside,
  heldToLimits,
  pieceAt,
  pieceFor,
  swappedPiece,
  turnedPiece,
  planStructureResize,
  structureConflicts,
  materialisedRuns,
  resolveEdges,
  styleEdgeProduct,
  treatmentForMaterial,
  withEdgeMode,
  withoutRun,
  withRunAdded,
  withRunDimension,
  withRunEnd,
  withRunTreatment,
  freeSpanAt,
  edgePlanOf,
  type EdgeDimension,
  type EdgeTreatment,
  type StructureConfigPatch,
  type StructureResizeRequest,
  type StructureResizeResult,
  type SymbolId,
} from '@garden-studio/schema';
import type {
  DesignEvent,
  DesignRevisionRecord,
  LayoutSection,
  Point,
  ProposedChange,
} from '@garden-studio/schema';
import { draftPolygon, polygonCentroid, reflowEdge } from '@/lib/boundary-geometry';
import { highestId } from '@/lib/hydration';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import {
  elementAnchor,
  isGroundLayer,
  isLocked,
  isUserLocked,
  layoutFingerprint,
  type DesignElement,
  type ElementCategory,
  type GeneratedConcept,
} from '@/lib/concepts';
import {
  elementIsLegal,
  geometryOutline,
  translateFeature,
  type PlanGeometry,
} from '@/lib/features';
import { snapLength, snapPoint, snapRotation } from '@/lib/grid';
import { NUDGE_STEP } from '@/lib/editor-shortcuts';
import { draftStep, finishedGeometry } from '@/lib/draw-draft';
import { isShown, viewGroupOf, type ViewGroup } from '@/lib/view-groups';
import type { AlignmentGuide } from '@/lib/guides';
import { housePolygon } from '@/lib/house';
import { defaultMaterial } from '@/lib/materials';
import { zoneAt, type ZoneId } from '@/lib/zones';
import { selectZones, useBoundaryStore } from './boundary-store';
import { edgeRulesNow } from '@/lib/edge-rules';
import { emitDesignEvent } from './design-events';

/**
 * Step 5's editor state: the chosen concept, made editable.
 *
 * Named `plan-editor-store` rather than `editor-store` because that name is taken by the legacy
 * `/design` editor, which is a different application surface entirely. Everything here is
 * prefixed `PlanEditor` for the same reason — importing both into one file should never be
 * ambiguous.
 *
 * A fourth wizard store rather than more fields on `concepts-store`, for the reason step 2 gave
 * for splitting from step 1: the undoable thing here is the layout, and this screen's Undo must
 * not rewind which concept was generated. Dependencies run one way — this reads the boundary and
 * concepts stores, never the reverse.
 *
 * Everything about *how* an edit is allowed to land is borrowed from `features-store.ts` rather
 * than reinvented: the same `commit` / `beginGesture` / `endGesture` shape, the same
 * refuse-don't-clamp rule, the same snapping helpers. Two screens that moved shapes around by
 * different rules would be two screens the user has to learn separately.
 */

const HISTORY_LIMIT = 50;

/** Arrow-key nudge in metres; Shift makes it a whole metre. Matches step 2. */
export const NUDGE = NUDGE_STEP;

/** Smallest side a resize handle will produce, in metres. Matches step 2's features. */
export const MIN_ELEMENT_SIDE = 0.3;

/*
 * There is no house message any more, because there is no house rule: a patio, a path or a
 * pergola attached to the building is the ordinary case, and the house is drawn over whatever
 * runs under it. The fence is the one edge left that an element may not cross.
 *
 * The two sentences live in `operations.ts` and are imported rather than written here, because an
 * AI run refuses for exactly these reasons and two copies of a refusal are two copies that can
 * drift into describing one rule two ways.
 */
const FENCE_CLASH = FENCE_REFUSAL;

export type PlanEditorMode = 'select' | 'pan' | 'measure';

export type PlacingTool = 'rect' | 'polygon' | 'polyline';

/** A new path's width, in metres, until the user changes it: a comfortable single-file path. */
export const DRAWN_PATH_WIDTH = 1;

/** The canvas's zoom, passed with a pointer so a snap reaches the same distance on screen at any zoom. */
export interface SnapZoom {
  pxPerMetre?: number;
}

function zoomReach(options: SnapZoom | undefined) {
  return { px: SNAP_REACH_PX, ...(options?.pxPerMetre ? { pxPerMetre: options.pxPerMetre } : {}) };
}

export interface PlanEditorDraft {
  elements: DesignElement[];
}

export interface ApplyOutcome {
  applied: string[];
  refused: { changeId: string; reason: string }[];
}

let elementCounter = 0;
function nextElementId(): string {
  elementCounter += 1;
  return `e-${elementCounter}`;
}

/**
 * An id for something about to be added to this plan, from the editor's own counter.
 *
 * Exposed so an AI run can bind the elements it is going to create *before* it animates them —
 * a run has to know an added thing's id in advance, because later operations in the same script
 * move and light the thing it just placed. Going through the same counter is what keeps those ids
 * `e-N`, which is what `hydratePlanEditorStore` re-seeds from on the next load.
 */
export function allocateElementId(): string {
  return nextElementId();
}

function emptyDraft(): PlanEditorDraft {
  return { elements: [] };
}

export interface EdgeEditState {
  hostId: string;
  selectedRunId: string | null;
  hoveredRunId: string | null;
}

export interface VertexEditState {
  id: string;
  selectedIndex: number | null;
}

/** Which structure the 3D editor has open. */
export interface StructureEditState {
  elementId: string;
  /**
   * The piece of furniture picked up inside the structure, if any. A sub-selection rather than
   * `selectedId`, because selecting anything else closes the 3D editor.
   */
  pieceId: string | null;
}

export interface PlanEditorState {
  past: PlanEditorDraft[];
  present: PlanEditorDraft;
  future: PlanEditorDraft[];

  /** Concept id this layout came from. A change to the chosen concept re-seeds. */
  seededFrom: string | null;
  /** The concept exactly as generated, so Reset has something true to go back to. */
  pristine: DesignElement[] | null;
  /**
   * The last AI redesign, so it can be undone after a reload.
   *
   * On the document rather than in session memory for the reason `pristine` is: the thing it
   * protects against outlives the tab. A redesign performs immediately and autosaves within the
   * second, so without this a misread request that the user reloads past is gone for good.
   */
  revision: DesignRevisionRecord | null;

  /*
   * Ephemeral. Outside history for the reason step 2 keeps its tools out: Undo should rewind the
   * garden, not which tool was last pressed.
   */
  mode: PlanEditorMode;
  /**
   * The primary selection — what the inspector, the Edges tab, the 3D editor and the AI run follow.
   * Always a member of `selectedIds` when set, so every reader that thinks in one element keeps
   * reading exactly what it always read.
   */
  selectedId: string | null;
  /** Everything selected, the primary last. Shift-click and the marquee add to it. */
  selectedIds: string[];
  /** A Shift-drag on bare canvas, in metres, while it is being drawn. */
  marquee: { start: Point; current: Point } | null;
  placingCategory: ElementCategory | null;
  /** With `placingCategory`: the thing being placed, when it is a piece of furniture. */
  placingSymbol: SymbolId | null;
  placingPlantId: string | null;
  /**
   * With `placingCategory: 'enclosure'`: which kind of fence, wall or screen the line tool is
   * drawing. An enclosure is only ever drawn along its line, so arming one arms the line tool.
   */
  placingEnclosure: EnclosureKind | null;
  /**
   * How an armed surface is put down: dragged out as a rectangle (a click drops the default size, as
   * it always did), drawn corner by corner, or drawn as a path. Symbols ignore it — a bench is placed.
   */
  placingTool: PlacingTool;
  /** The corners clicked so far while drawing a shape or a path. */
  draftPoints: Point[];
  snapEnabled: boolean;
  /** Graph paper on or off. A view preference, so it never enters the undo history. */
  gridVisible: boolean;
  /**
   * Whether the drawing casts shadows. A view preference beside `gridVisible`.
   *
   * On by default: a garden whose objects are not attached to the ground reads as a diagram, and
   * since the conventional light landed every plan can draw them rather than only the ones that
   * have stated a location. Off is a real thing to want — a drawing somebody is about to measure,
   * print or write on, or two layouts being compared rather than one being admired.
   *
   * A preference and not a design decision, so it is ephemeral for the same reason the grid is:
   * nothing about the geometry, the areas or the schedule can see it.
   */
  shadowsVisible: boolean;
  /**
   * Whether the plan is annotated.
   *
   * A viewing preference, not a design decision, so it sits in `ephemeralState` beside
   * `gridVisible` rather than on the document — the same reasoning that keeps the grid out of the
   * saved plan. Off by default: the plan opens on the garden, and the chips are one switch away
   * for reading it as a document.
   */
  labelsVisible: boolean;
  /**
   * Zone names and dimension guides, both view preferences beside `gridVisible`.
   *
   * Zones are **off** by default on this screen and that is deliberate rather than an oversight:
   * they are scaffolding for "which parts do you want designed", and once that is answered writing
   * "Back garden ≈ 18 m²" across a finished design is a note about the tool rather than about the
   * garden. The toggle exists because a user checking their own answer should be able to see them
   * again — which they could not before, on any screen.
   *
   * Dimensions are off by default too, for the reason labels are: the plan opens on the garden, and
   * the plot's side lengths are one switch away.
   */
  zonesVisible: boolean;
  dimensionsVisible: boolean;
  /**
   * The view groups switched off — "hide the furniture so I can see the paving". A view preference
   * with the same five edit points as the grid, and outside the history for the same reason: Undo
   * rewinds the garden, not what was being looked at. The per-element eye is a different thing and
   * stays on the document.
   */
  hiddenGroups: ViewGroup[];
  alignments: AlignmentGuide[];
  /**
   * The exact corner, midpoint or point on an edge the current drag has snapped to, for the canvas to
   * mark — a flush pull onto a wall is invisible without it. Mid-gesture only, like the guides.
   */
  snapMarker: Point | null;
  measurement: { from: Point; to: Point | null } | null;
  clash: string | null;
  gestureSnapshot: PlanEditorDraft | null;
  /**
   * The Edges tab's working state, or null when it is closed.
   *
   * Which surface's boundary is open, which run is selected (the only one that shows handles) and
   * which run is under the pointer — shared by the canvas and the inspector's segment list, which is
   * what lets hovering one light the other. Ephemeral, with the **five edit points** every view
   * preference has; the one that bites is `ephemeralState()`, or the tab survives a reload.
   */
  edgeEdit: EdgeEditState | null;
  /**
   * The focused 3D structure editor, or null when the plan is showing.
   *
   * A workspace state rather than a route, deliberately: the editor keeps its undo history, its
   * gesture-gated autosave, the canvas's viewport and the assistant's session, because nothing is
   * unmounted. It edits the same `DesignElement` the plan does — there is no draft copy — so the
   * plan behind it is always already up to date. Ephemeral, with the five edit points every view
   * preference has, `ephemeralState()` included.
   */
  structureEdit: StructureEditState | null;
  /**
   * Corner editing, or null. Which polygon or path has its corners showing, and which corner is
   * picked — Delete removes that one. Ephemeral with the five edit points every view state has;
   * selecting anything else ends it, the way `edgeEdit` ends.
   */
  vertexEdit: VertexEditState | null;
  lastSavedAt: number;

  seedFrom: (concept: GeneratedConcept) => void;
  /** Selects one thing; with `additive`, toggles it in or out of the selection. */
  select: (id: string | null, options?: { additive?: boolean }) => void;
  /** Replaces the selection with these, the last one primary. */
  selectMany: (ids: string[]) => void;
  /** Everything shown except the ground layer — ⌘A. */
  selectAll: () => void;
  beginMarquee: (at: Point) => void;
  trackMarquee: (at: Point) => void;
  /** Adds what the marquee touches to the selection. True when it selected anything. */
  commitMarquee: () => boolean;
  /** Deletes everything selected, as one undo entry. */
  deleteSelection: () => void;
  /** Duplicates everything selected, as one undo entry, and selects the copies. */
  duplicateSelection: () => void;
  /** Gives every selected element of one category the same material, as one undo entry. */
  setMaterialForSelection: (materialId: string) => void;

  /**
   * Places the armed thing at a point. `keepArmed` leaves it armed for the next click — Shift held
   * while placing — so five trees are five clicks rather than five trips to the palette.
   */
  addElement: (
    category: ElementCategory,
    at: Point,
    options?: { keepArmed?: boolean; size?: { width: number; depth: number } },
  ) => void;
  setPlacingTool: (tool: PlacingTool) => void;
  /** A click while drawing: adds a corner, or closes the shape on its first corner. */
  addDraftPoint: (
    raw: Point,
    options?: SnapZoom & { keepArmed?: boolean },
  ) => 'added' | 'closed' | 'ignored';
  /** Where a click at `raw` would put the next corner — for the ghost, so it cannot promise otherwise. */
  previewDraftPoint: (raw: Point, options?: SnapZoom) => Point;
  /** Ends the drawing and adds the shape, if it is one. */
  finishDraft: (options?: { keepArmed?: boolean }) => void;
  cancelDraft: () => void;
  /**
   * One frame of a drag. `pxPerMetre` is the canvas's zoom, so a snap reaches the same distance on
   * screen at every zoom; without it the reach is the old fixed 0.3 m, which is what tests get.
   */
  moveElementLive: (id: string, anchor: Point, options?: SnapZoom) => void;
  setPosition: (id: string, anchor: Point) => void;
  setCanopyDiameter: (id: string, metres: number) => void;
  replaceSymbol: (id: string, symbol: SymbolId, plantId?: string) => void;
  /**
   * A fence's kind, or a hedge's species. A new kind brings its own thickness and, unless what it
   * is built of already suits it, its own material — a wall of close-board fencing is not a wall.
   */
  setEnclosure: (id: string, patch: { kind?: EnclosureKind; plantId?: string | null }) => void;
  /** A bed's own species mix, or `undefined` to plant it from its material's again. */
  setPlanting: (id: string, planting: BedPlanting | undefined) => void;
  setStatus: (id: string, status: DesignElement['status']) => void;
  /**
   * One frame of a resize. With snap on, a dragged side is tidied to the decimetre; `exact` is for
   * a typed size, which is already the number the person meant.
   */
  resizeElementLive: (
    id: string,
    size: Partial<{ width: number; depth: number }>,
    options?: { exact?: boolean },
  ) => void;
  /**
   * A typed width or depth: one resize about the centre, keeping the rotation, with one undo entry.
   * The 2D inspector and the 3D editor both call this, so there is one way a structure is resized.
   */
  setSize: (id: string, size: Partial<{ width: number; depth: number }>) => void;
  /**
   * One frame of a rotation. With snap on, a dragged angle lands on a 15° step or square to the
   * house; `exact` is for a typed or slid value, which is already the number the person meant.
   */
  rotateElementLive: (id: string, degrees: number, options?: { exact?: boolean }) => void;
  nudgeSelection: (dx: number, dy: number) => void;

  renameElement: (id: string, name: string) => void;
  setMaterial: (id: string, materialId: string) => void;
  /** The product automatic edging prefers. `''` clears it back to whatever the style picks. */
  setEdging: (id: string, materialId: string) => void;

  openEdgeEdit: (hostId: string) => void;
  closeEdgeEdit: () => void;
  /** Opens the 3D editor on a configurable structure, selecting it. Refused for anything else. */
  openStructureEdit: (id: string) => void;
  closeStructureEdit: () => void;
  /** A change to a structure's roof, sides, lighting or preset. Never its footprint. */
  setStructure: (id: string, patch: StructureConfigPatch) => void;
  /**
   * A structure given a preset's whole look — frame, roof, sides, lighting and height — as one undo
   * entry. Never its size or its place.
   */
  setStructurePreset: (id: string, presetId: string) => void;
  /**
   * A structure resized as a design decision: it keeps the side it is against, stays inside the
   * sizes it is made in, and is applied (one undo entry) only when it runs into nothing. The result
   * is returned rather than stored, so a caller can show what is in the way and what would work.
   */
  resizeStructure: (id: string, request: StructureResizeRequest) => StructureResizeResult;
  /**
   * One frame of a resize-handle drag in the 3D editor. Planned from the structure as it stood when
   * the gesture began, so every frame is the same question asked with a different size rather than a
   * resize of a resize; a blocked frame changes nothing and leaves the last one that fitted on screen.
   * Bracket with a gesture.
   */
  resizeStructureLive: (id: string, request: StructureResizeRequest) => StructureResizeResult;
  /** One frame of a height-handle drag, held to the structure's limits. Bracket with a gesture. */
  setStructureHeightLive: (id: string, metres: number) => void;
  /**
   * One of the alternatives a blocked resize offered, checked again against the plan as it is now
   * and applied as one undo entry. False when the plan has changed underneath it.
   */
  applyStructureCandidate: (id: string, candidate: DesignElement) => boolean;

  /*
   * What stands inside the structure being edited in 3D. Each is one undo entry and is refused with a
   * sentence in `clash` rather than half-applied; "inside" is containment, read every time.
   */
  selectPiece: (pieceId: string | null) => void;
  /** A new piece centred in the structure. Returns its id, or null when there is no room. */
  addPiece: (structureId: string, symbol: SymbolId) => string | null;
  /** The piece swapped for another, at the new thing's own size. */
  swapPiece: (pieceId: string, symbol: SymbolId) => void;
  turnPiece: (pieceId: string) => void;
  /** One frame of a drag across the floor, held inside the structure. Bracket with a gesture. */
  movePieceLive: (pieceId: string, at: Point) => void;
  selectEdgeRun: (runId: string | null) => void;
  hoverEdgeRun: (runId: string | null) => void;
  /** Auto, None or Custom. Entering Custom materialises what Auto was drawing. */
  setEdgeMode: (id: string, mode: 'auto' | 'none' | 'custom') => void;
  /** A run over the free stretch at a point on a side; returns its id, or null where there is none. */
  addEdgeRunAt: (id: string, side: number, distance: number) => string | null;
  /** One frame of an end-handle drag. No history entry: the gesture bracket supplies it. */
  setEdgeRunEndLive: (id: string, runId: string, end: 'from' | 'to', distance: number) => void;
  setEdgeRunTreatment: (id: string, runId: string, treatment: EdgeTreatment) => void;
  /** `null` clears the dimension back to the product's own. */
  setEdgeRunDimension: (id: string, runId: string, dimension: EdgeDimension, millimetres: number | null) => void;
  removeEdgeRun: (id: string, runId: string) => void;
  /** `''` clears it back to a plain upstand in the element's own paving. */
  setRetaining: (id: string, materialId: string) => void;
  setZone: (id: string, zone: ZoneId) => void;
  setElevation: (id: string, metres: number) => void;
  toggleHidden: (id: string) => void;
  /**
   * Locks the given elements, or unlocks them if every one is already locked — one undo entry. A
   * lock holds geometry still by hand and holds everything still against the designer; the ground
   * layer is locked already and is left out.
   */
  toggleLocked: (ids: string[]) => void;

  /** Shows a polygon's or a path's corners for editing. Refused for anything else, or anything locked. */
  openVertexEdit: (id: string) => void;
  closeVertexEdit: () => void;
  selectVertex: (index: number | null) => void;
  /** One frame of a corner drag: snapped, refused if it folds the outline or leaves the plot. */
  moveVertexLive: (id: string, index: number, at: Point, options?: SnapZoom) => void;
  /** A new corner on the edge that starts at `edgeIndex`. One undo entry. */
  insertVertex: (id: string, edgeIndex: number, at: Point) => void;
  /** One undo entry; refused below a shape's minimum corners. */
  deleteVertex: (id: string, index: number) => void;
  /** A frame of the corner-radius slider — the panel brackets it, so a slide is one undo entry. */
  setCornerRadiusLive: (id: string, radius: number) => void;
  setPathWidth: (id: string, width: number) => void;
  /** A typed side length, moving one corner as step 1's side lengths do. One undo entry. */
  setSideLength: (id: string, edgeIndex: number, metres: number) => void;
  /** A rectangular surface becomes a polygon with the same four corners. One undo entry. */
  convertToPolygon: (id: string) => void;
  duplicateElement: (id: string) => void;
  deleteElement: (id: string) => void;

  beginGesture: () => void;
  /** `silent` suppresses the design event, for a caller that reports its own. */
  endGesture: (options?: { silent?: boolean }) => void;
  /** Records a redesign, so it can be taken back after a reload. */
  recordRevision: (record: DesignRevisionRecord) => void;
  /** Takes the last recorded redesign back. Works across a reload, unlike the history stack. */
  undoRevision: () => void;
  undo: () => void;
  redo: () => void;
  resetToConcept: () => void;

  toggleSnap: () => void;
  toggleGrid: () => void;
  toggleShadows: () => void;
  toggleLabels: () => void;
  toggleZones: () => void;
  toggleDimensions: () => void;
  /** Shows or hides a whole view group. Hiding the group the selection is in lets go of it. */
  toggleGroup: (group: ViewGroup) => void;
  /** Metres tall. Read by the shadow model, and until now invisible to the user who owns it. */
  setHeight: (id: string, metres: number) => void;
  setMode: (mode: PlanEditorMode) => void;
  setPlacing: (
    category: ElementCategory | null,
    symbol?: SymbolId | null,
    plantId?: string | null,
  ) => void;
  /** Arms the line tool to draw a fence, a screen, a wall, a hedge, a railing, a kerb or an opening. */
  setPlacingEnclosure: (kind: EnclosureKind | null) => void;
  addMeasurePoint: (point: Point, options?: SnapZoom) => void;
  trackMeasurePointer: (point: Point, options?: SnapZoom) => void;
  clearMeasurement: () => void;
  clearClash: () => void;

  /**
   * Applies the accepted lines of one proposal as a single history entry.
   *
   * `withinGesture` says a bracket is already open and this must not close it. That is the
   * reduced-motion path: the design agent opens one bracket over the whole sentence, and a nested
   * `endGesture` here would close it early, push its own undo entry, and leave the review passes
   * that follow in a second entry — the exact defect one-bracket-per-sentence exists to prevent.
   */
  applyProposal: (
    changes: ProposedChange[],
    acceptedIds: string[],
    options?: { withinGesture?: boolean },
  ) => ApplyOutcome;
}

/* ---------------------------------------------------------------- the property, read live */

function housePolygonNow(): Point[] | null {
  const house = useBoundaryStore.getState().present.house;
  return house ? housePolygon(house) : null;
}

function boundaryNow(): Point[] {
  return draftPolygon(useBoundaryStore.getState().present);
}

/** What a boundary run may lie along, read live — the same two rings the renderer resolves against. */
export function edgeContextNow(): { boundary: Point[]; house?: Point[] } {
  const house = housePolygonNow();
  return { boundary: boundaryNow(), ...(house ? { house } : {}) };
}


/** The structure open in the 3D editor, if there is one. */
function structureOf(state: { structureEdit: StructureEditState | null; present: PlanEditorDraft }) {
  const id = state.structureEdit?.elementId;
  return id ? (state.present.elements.find((item) => item.id === id) ?? null) : null;
}

/** What a structure's resize measures against, read live. */
export function structureContextNow(elements: DesignElement[]) {
  return { elements, boundary: boundaryNow(), house: housePolygonNow() };
}

/**
 * What a run added by hand is made of, before the user picks.
 *
 * The surface's own product if it names one, else the style's, else brick — never `none`, because
 * a run somebody just asked for that draws nothing would look like the click did nothing.
 */
function defaultTreatmentFor(element: DesignElement): EdgeTreatment {
  const rules = edgeRulesNow();
  const product = element.edging ?? styleEdgeProduct(rules.style, rules.budget, rules.maintenance);
  const treatment = treatmentForMaterial(product ?? undefined);
  return treatment === 'none' ? 'brick' : treatment;
}

/**
 * Why an edit was refused, or null if it is fine. Step 2's rule, verbatim.
 *
 * Takes the **element** rather than its shape, so `elementIsLegal` can ask about the right one: a
 * tree's stored shape is its canopy and what has to be inside the fence is its trunk. Handed a
 * bare geometry this could not tell a tree from a pond, and the editor would refuse a tree the
 * generator drew and the server accepts — with no way for the user to see why or put it right.
 */
function refusalFor(element: DesignElement): string | null {
  return elementIsLegal(element, boundaryNow()) ? null : FENCE_CLASH;
}

/** Default sizes for a hand-placed element, by category. */
const NEW_ELEMENT_SIZE: Record<ElementCategory, { width: number; depth: number }> = {
  'paved-area': { width: 3, depth: 3 },
  lawn: { width: 4, depth: 3 },
  'planting-bed': { width: 3, depth: 1.5 },
  'gravel-mulch': { width: 2.5, depth: 2.5 },
  structure: { width: 2.5, depth: 2 },
  'water-feature': { width: 1.5, depth: 1.5 },
  furniture: { width: 2.4, depth: 2.4 },
  /* Only ever a fallback: every light carries a symbol, and `SYMBOLS` gives the real footprint. */
  lighting: { width: 0.2, depth: 0.2 },
  'existing-feature': { width: 2, depth: 2 },
  /* Only ever a fallback: an enclosure is drawn with the line tool, never dropped as a box. */
  enclosure: { width: 3, depth: 0.1 },
};

/** "Patio", then "Patio 2" — the same rule step 2 names features by. */
function defaultName(category: ElementCategory, existing: DesignElement[]): string {
  const base = CATEGORY_COLOURS[category].label;
  const taken = new Set(existing.map((element) => element.name));

  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

/**
 * What a copy is called: the original's own name with the next free number — "Lounger 2", never
 * "Furniture 2".
 *
 * `defaultName` answers from the category, which is right for something new and wrong for a copy:
 * a copy of the "Dining pergola" is another dining pergola. A name already ending in a number is
 * counted on from its stem, so copying "Planter 2" gives "Planter 3" rather than "Planter 2 2".
 */
export function copyName(element: DesignElement, existing: DesignElement[]): string {
  if (!element.name) return defaultName(element.category, existing);

  const stem = element.name.replace(/\s+\d+$/, '');
  const taken = new Set(existing.map((candidate) => candidate.name));
  let suffix = 2;
  while (taken.has(`${stem} ${suffix}`)) suffix += 1;
  return `${stem} ${suffix}`;
}

/** A selection of exactly one thing, or of nothing. */
/**
 * A new material, and for a bed chosen from a mix, the end of any mix of its own: picking "Shade
 * woodland" is asking for that mix, and a custom one left behind would go on overriding it — the
 * swatch would light up and the bed would not change. Any other material leaves a custom mix alone,
 * because there the material is only the drawing base the mix sits on.
 */
function withMaterial(element: DesignElement, materialId: string): DesignElement {
  const next = { ...element, material: materialId };
  if (element.planting && isPlantingMix(materialId)) delete next.planting;
  return next;
}

function only(id: string | null): { selectedId: string | null; selectedIds: string[] } {
  return { selectedId: id, selectedIds: id ? [id] : [] };
}

/**
 * The state that follows from selecting `ids`, the last one primary.
 *
 * Returns **the unchanged state** when nothing changed. The AI run's controller calls `select` on
 * every animation frame with the element it is working on, and a fresh array each time would
 * re-render every subscriber at frame rate for a selection that never moved.
 *
 * The workspaces that belong to one element — its Edges tab, its corners, the 3D editor — stay open
 * only while that element is still the primary, because each is an editor of exactly one thing.
 */
function withSelection<
  S extends {
    selectedId: string | null;
    selectedIds: string[];
    edgeEdit: EdgeEditState | null;
    structureEdit: StructureEditState | null;
    vertexEdit: VertexEditState | null;
    clash: string | null;
  },
>(state: S, ids: string[]): Partial<S> | S {
  const unique = ids.filter((id, index) => ids.indexOf(id) === index);
  const primary = unique.at(-1) ?? null;
  if (
    primary === state.selectedId &&
    unique.length === state.selectedIds.length &&
    unique.every((id, index) => state.selectedIds[index] === id)
  ) {
    return state.clash === null ? state : ({ clash: null } as Partial<S>);
  }
  return {
    selectedId: primary,
    selectedIds: unique,
    clash: null,
    edgeEdit: state.edgeEdit && state.edgeEdit.hostId === primary ? state.edgeEdit : null,
    structureEdit:
      state.structureEdit && state.structureEdit.elementId === primary ? state.structureEdit : null,
    vertexEdit: state.vertexEdit && state.vertexEdit.id === primary ? state.vertexEdit : null,
  } as Partial<S>;
}

/**
 * The selection after an undo or a redo lands on `draft`.
 *
 * What the step brought back is selected — a redone duplicate, an undone delete — which is what every
 * editor does and what makes "undo, then redo, then Delete" delete the thing that came back rather
 * than nothing. Otherwise anything the step took off the plan is let go of, so the inspector never
 * describes an element that is no longer there.
 */
function historySelection(
  state: { selectedId: string | null; selectedIds: string[]; present: PlanEditorDraft },
  draft: PlanEditorDraft,
): Partial<{ selectedId: string | null; selectedIds: string[] }> {
  const before = new Set(state.present.elements.map((element) => element.id));
  const returned = draft.elements.filter((element) => !before.has(element.id)).map((element) => element.id);
  if (returned.length > 0) return { selectedIds: returned, selectedId: returned.at(-1) ?? null };

  const ids = state.selectedIds.filter((id) => draft.elements.some((element) => element.id === id));
  if (ids.length === state.selectedIds.length) return {};
  return { selectedIds: ids, selectedId: ids.includes(state.selectedId ?? '') ? state.selectedId : (ids.at(-1) ?? null) };
}

/**
 * Whether a rectangle may become a free shape: a surface, and nothing else.
 *
 * A structure or a piece of furniture is its rectangle — its parts, its furniture, its 3D model and
 * its resize rules are all read off the rect — and anything with a symbol is a product of a given
 * shape. A patio, a lawn, a bed or a panel of gravel is only a rectangle because that is how it was
 * dropped.
 */
export function canConvertToPolygon(element: DesignElement): boolean {
  return (
    element.shape.kind === 'rect' &&
    !element.symbol &&
    element.category !== 'structure' &&
    element.category !== 'furniture' &&
    element.category !== 'lighting' &&
    element.category !== 'existing-feature' &&
    !isLocked(element)
  );
}

export const usePlanEditorStore = create<PlanEditorState>((set, get) => {
  /** Pushes the current layout onto the undo stack and replaces it with the mutated one. */
  function commit(mutate: (draft: PlanEditorDraft) => PlanEditorDraft | null) {
    set((state) => {
      const next = mutate(state.present);
      if (!next || next === state.present) return state;

      return {
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: { ...next, elements: associatePlants(next.elements) },
        future: [],
        lastSavedAt: Date.now(),
        clash: null,
      };
    });
  }

  /**
   * Replaces one element, refusing the change outright if the result is illegal or the element is
   * locked ground.
   *
   * `checkGeometry` is false for edits that cannot move anything — a rename, a material swap —
   * so a base fill can still be re-materialised while staying unmovable.
   */
  function commitElement(
    id: string,
    mutate: (element: DesignElement) => DesignElement,
    options: { checkGeometry?: boolean } = {},
  ) {
    const checkGeometry = options.checkGeometry ?? true;
    let refusal: string | null = null;

    commit((draft) => {
      const element = draft.elements.find((candidate) => candidate.id === id);
      if (!element) return null;

      if (checkGeometry && isLocked(element)) {
        refusal = lockRefusal(element);
        return null;
      }

      const next = mutate(element);
      if (next === element) return null;

      if (checkGeometry) {
        // A resize or a move has no meaningful partial version, so an impossible one is refused
        // rather than half-applied — the same call step 2's features make.
        refusal = refusalFor(next);
        if (refusal) return null;
      }

      return {
        ...draft,
        elements: draft.elements.map((candidate) => (candidate.id === id ? next : candidate)),
      };
    });

    if (refusal) set({ clash: refusal });
  }

  /**
   * A frame of a drag: no history entry, and an illegal result is dropped rather than clamped.
   *
   * This is the half of step 2's store that is easy to miss. `commitElement` earns a history
   * entry every time it is called, which is right for a one-shot edit and catastrophic for a
   * drag — forty mousemoves would leave forty entries and forty presses of Undo. Live frames
   * write `present` directly, and the gesture bracket supplies the single entry at the end.
   *
   * Unlike step 2's version this also reports the refusal. A shape that silently stops following
   * the cursor looks like a broken canvas; saying "that goes over the property boundary" while it
   * will not go costs nothing and explains itself. The next legal frame clears it.
   */
  function applyLive(id: string, mutate: (element: DesignElement) => DesignElement) {
    set((state) => {
      const element = state.present.elements.find((candidate) => candidate.id === id);
      if (!element) return state;
      if (isLocked(element)) return { clash: lockRefusal(element) };

      const next = mutate(element);
      if (next === element) return state;

      const refusal = refusalFor(next);
      if (refusal) return { clash: refusal };

      return {
        present: {
          ...state.present,
          elements: associatePlants(
            state.present.elements.map((candidate) => (candidate.id === id ? next : candidate)),
          ),
        },
        clash: null,
      };
    });
  }

  /**
   * A frame of an edge-handle drag. Like `applyLive` it writes `present` with no history entry —
   * the gesture bracket supplies one — but with neither of its checks: a locked base fill may still
   * be edged, and nothing about the outline changes. A refused frame (too short, past the next run)
   * leaves the last legal one on screen, which is what makes the handle stop dead at a limit.
   */
  function applyEdgeLive(id: string, mutate: (element: DesignElement) => DesignElement | null) {
    set((state) => {
      const element = state.present.elements.find((candidate) => candidate.id === id);
      if (!element) return state;
      const next = mutate(element);
      if (!next || next === element) return state;
      return {
        present: {
          ...state.present,
          elements: state.present.elements.map((candidate) => (candidate.id === id ? next : candidate)),
        },
      };
    });
  }

  function snapped(point: Point): Point {
    if (!get().snapEnabled) return point;
    return snapPoint(point, useBoundaryStore.getState().unit);
  }

  /*
   * The plan's snap targets, built once per gesture rather than on every mousemove: a drag asks for
   * them forty times a second and they cannot change while the drag is holding the plan. Kept in the
   * closure rather than the state because nothing draws them, so they need none of the five edit
   * points a view preference has — `beginGesture` and `endGesture` are the only two that matter.
   */
  let gestureTargets: { key: string; targets: PlanSnapTargets } | null = null;

  function planTargetsExcluding(ids: string[]): PlanSnapTargets {
    const key = ids.join(',');
    const inGesture = get().gestureSnapshot !== null;
    if (inGesture && gestureTargets?.key === key) return gestureTargets.targets;

    const hiddenGroups = get().hiddenGroups;
    const targets = snapTargetsFor({
      boundary: boundaryNow(),
      house: housePolygonNow(),
      elements: get().present.elements.filter(
        (element) => !ids.includes(element.id) && isShown(element, hiddenGroups),
      ),
    });
    gestureTargets = inGesture ? { key, targets } : null;
    return targets;
  }

  /** Where a pointer lands for the tape: a corner, a midpoint or an edge, never the grid. */
  function snappedPointer(point: Point, options: SnapZoom | undefined): Point {
    return snapPointTo(point, planTargetsExcluding([]), {
      enabled: get().snapEnabled,
      unit: useBoundaryStore.getState().unit,
      grid: false,
      threshold: zoomReach(options),
    }).point;
  }

  /**
   * A frame of a group move: every member by the same amount, or none of them.
   *
   * All-or-nothing, like step 2's group drag: half a selection crossing the fence while the rest
   * follows the pointer would break the arrangement the user selected them to keep. A locked member
   * refuses the whole move and says so.
   */
  function moveGroupLive(ids: string[], dx: number, dy: number): boolean {
    const state = get();
    const members = state.present.elements.filter((element) => ids.includes(element.id));
    const held = members.find(isLocked);
    if (held) {
      set({ clash: lockRefusal(held) });
      return false;
    }
    const moved = new Map(
      members.map((element) => {
        const at = elementAnchor(element);
        return [element.id, translateTo(element, { x: at.x + dx, y: at.y + dy })] as const;
      }),
    );
    for (const next of moved.values()) {
      const refusal = refusalFor(next);
      if (refusal) {
        set({ clash: refusal });
        return false;
      }
    }
    set({
      present: {
        ...state.present,
        elements: associatePlants(state.present.elements.map((element) => moved.get(element.id) ?? element)),
      },
      clash: null,
    });
    return true;
  }

  /**
   * A change to an outline's corners, checked and applied.
   *
   * The attempt is built first and refused with its reason — an outline folding through itself, a
   * shape too small to be one, a corner over the fence — rather than clamped, and the edge plan is
   * reset where the corner count changed, because every custom run is keyed on a side's index.
   * `live` writes a frame of a drag with no history entry (the gesture bracket supplies one);
   * otherwise it is one undo entry of its own.
   */
  function reshapeCorners(
    id: string,
    reshape: (shape: PlanGeometry) => PlanGeometry | null,
    mode: 'live' | 'commit',
  ): boolean {
    const element = get().present.elements.find((candidate) => candidate.id === id);
    if (!element) return false;
    if (isLocked(element)) {
      set({ clash: lockRefusal(element) });
      return false;
    }
    const shape = reshape(element.shape);
    if (!shape) return false;
    const refusal = vertexEditRefusal(shape);
    if (refusal) {
      set({ clash: refusal });
      return false;
    }
    const next = edgesAfterVertexEdit(element, { ...element, shape });
    if (mode === 'live') applyLive(id, () => next);
    else commitElement(id, () => next);
    return get().clash === null;
  }

  /**
   * Where a drawn corner lands: on a corner, a midpoint or an edge of what is already there, else
   * square to the last side drawn, else the grid. The ghost and the click both ask this, so the
   * preview cannot promise a position the click then fails to deliver.
   */
  function draftSnap(raw: Point, points: Point[], options: SnapZoom | undefined): Point {
    return snapPointTo(raw, planTargetsExcluding([]), {
      enabled: get().snapEnabled,
      unit: useBoundaryStore.getState().unit,
      threshold: zoomReach(options),
      rightAngle: points.length > 0 ? { vertices: points } : null,
    }).point;
  }

  /** A drawn shape, named, zoned and checked the way a placed one is. True when it landed. */
  function addDrawnElement(
    category: ElementCategory,
    shape: PlanGeometry,
    extra: Partial<DesignElement> = {},
  ): boolean {
    const id = nextElementId();
    const zones = selectZones({ present: useBoundaryStore.getState().present });
    const outline = geometryOutline(shape);
    const added: DesignElement = {
      id,
      category,
      role: 'feature',
      name: defaultName(category, get().present.elements),
      shape,
      zone: zoneAt(polygonCentroid(outline), zones)?.id ?? 'back',
      material: defaultMaterial(category),
      elevation: 0,
      ...extra,
    };
    const refusal = refusalFor(added);
    if (refusal) {
      set({ clash: refusal });
      return false;
    }
    commit((draft) => ({ ...draft, elements: [...draft.elements, added] }));
    set(only(id));
    emitDesignEvent('element_added', { elementId: id, category });
    return true;
  }

  /**
   * The bearings a dragged rotation may square to: the house, the wall and the fence nearest the
   * element, and the nearest thing beside it — so a bench can be turned square to the bed it faces,
   * not only to the building. Each is good at every quarter turn (`snapRotation`).
   */
  function rotationReferences(element: DesignElement): number[] {
    const centre = elementAnchor(element);
    const house = useBoundaryStore.getState().present.house;
    const houseRing = housePolygonNow();
    const references = [
      house?.rotation,
      nearestEdgeBearing(boundaryNow(), centre),
      houseRing ? nearestEdgeBearing(houseRing, centre) : null,
    ];

    let nearest: { element: DesignElement; distance: number } | null = null;
    for (const other of get().present.elements) {
      if (other.id === element.id || isGroundLayer(other) || !isShown(other, get().hiddenGroups)) continue;
      const at = elementAnchor(other);
      const distance = Math.hypot(at.x - centre.x, at.y - centre.y);
      if (!nearest || distance < nearest.distance) nearest = { element: other, distance };
    }
    if (nearest) references.push(bearingOfElement(nearest.element));

    return references.filter((bearing): bearing is number => typeof bearing === 'number');
  }

  function translateTo(element: DesignElement, anchor: Point): DesignElement {
    const from = elementAnchor(element);
    const shifted = translateFeature(
      {
        id: '',
        kind: 'other',
        name: '',
        geometry: element.shape,
        status: 'keep',
        replaceWith: null,
      },
      anchor.x - from.x,
      anchor.y - from.y,
    ).geometry;

    return { ...element, shape: shifted };
  }

  return {
    past: [],
    present: emptyDraft(),
    future: [],

    seededFrom: null,
    pristine: null,
    revision: null,

    mode: 'select',
    selectedId: null,
    selectedIds: [],
    marquee: null,
    placingCategory: null,
    placingSymbol: null,
    placingPlantId: null,
    placingEnclosure: null,
    placingTool: 'rect',
    draftPoints: [],
    snapEnabled: true,
    gridVisible: false,
    shadowsVisible: true,
    labelsVisible: false,
    zonesVisible: false,
    dimensionsVisible: false,
    hiddenGroups: [],
    alignments: [],
    snapMarker: null,
    measurement: null,
    clash: null,
    gestureSnapshot: null,
    edgeEdit: null,
    structureEdit: null,
    vertexEdit: null,
    lastSavedAt: Date.now(),

    /**
     * Loads a concept as the working layout, discarding whatever was here.
     *
     * Called on arrival and again whenever the chosen concept changes, so the editor always shows
     * the concept the user actually chose. Materials are stamped in on the way through — the
     * generator does not pick one, and every panel downstream would otherwise have to keep
     * remembering to fall back to the category default.
     */
    seedFrom: (concept) => {
      const elements = concept.elements.map((element) => ({
        ...element,
        material: element.material ?? defaultMaterial(element.category),
        elevation: element.elevation ?? 0,
      }));

      set({
        past: [],
        present: { elements },
        future: [],
        seededFrom: concept.id,
        pristine: elements,
        /* A fresh concept is a different garden; an offer to undo a redesign of the old one is not. */
        revision: null,
        ...only(null),
        placingCategory: null,
        placingSymbol: null,
        placingPlantId: null,
        placingEnclosure: null,
        draftPoints: [],
        alignments: [],
        measurement: null,
        clash: null,
        gestureSnapshot: null,
        lastSavedAt: Date.now(),
      });
    },

    /*
     * Selecting something else leaves edge editing without a mode to exit: the Edges tab belongs to
     * the surface it was opened on, so clicking another element simply closes it.
     */
    select: (id, options = {}) =>
      set((state) => {
        let ids: string[];
        if (id === null) ids = [];
        else if (options.additive) {
          ids = state.selectedIds.includes(id)
            ? state.selectedIds.filter((candidate) => candidate !== id)
            : [...state.selectedIds, id];
        } else ids = [id];
        return withSelection(state, ids);
      }),

    selectMany: (ids) => set((state) => withSelection(state, ids)),

    selectAll: () =>
      set((state) =>
        withSelection(
          state,
          state.present.elements
            .filter((element) => !isGroundLayer(element) && isShown(element, state.hiddenGroups))
            .map((element) => element.id),
        ),
      ),

    beginMarquee: (at) => set({ marquee: { start: at, current: at } }),

    trackMarquee: (at) => set((state) => (state.marquee ? { marquee: { ...state.marquee, current: at } } : state)),

    commitMarquee: () => {
      const { marquee, present, hiddenGroups, selectedIds } = get();
      set({ marquee: null });
      if (!marquee) return false;
      /*
       * Touching counts, not only enclosing — step 2's rule, and the one a person expects when they
       * sweep across a row of beds. The ground layer is left out: it is under everything, so every
       * sweep would catch it.
       */
      const box = {
        minX: Math.min(marquee.start.x, marquee.current.x),
        maxX: Math.max(marquee.start.x, marquee.current.x),
        minY: Math.min(marquee.start.y, marquee.current.y),
        maxY: Math.max(marquee.start.y, marquee.current.y),
      };
      const caught = present.elements
        .filter((element) => !isGroundLayer(element) && isShown(element, hiddenGroups))
        .filter((element) => {
          const bounds = boundingBox(geometryOutline(element.shape));
          return (
            bounds.minX <= box.maxX &&
            bounds.minX + bounds.width >= box.minX &&
            bounds.minY <= box.maxY &&
            bounds.minY + bounds.length >= box.minY
          );
        })
        .map((element) => element.id);
      if (caught.length === 0) return false;
      set((state) => withSelection(state, [...selectedIds.filter((id) => !caught.includes(id)), ...caught]));
      return true;
    },

    deleteSelection: () => {
      const { selectedIds, present } = get();
      const targets = present.elements.filter((element) => selectedIds.includes(element.id));
      if (targets.length === 0) return;
      if (targets.length === 1) {
        get().deleteElement(targets[0]!.id);
        return;
      }
      const held = targets.find(isLocked);
      if (held) {
        set({ clash: lockRefusal(held) });
        return;
      }
      commit((draft) => ({
        ...draft,
        elements: draft.elements.filter((element) => !selectedIds.includes(element.id)),
      }));
      set((state) => ({ ...withSelection(state, []), structureEdit: null }));
      for (const element of targets) {
        emitDesignEvent('element_deleted', { elementId: element.id, category: element.category });
      }
    },

    duplicateSelection: () => {
      const { selectedIds, present } = get();
      const targets = present.elements.filter((element) => selectedIds.includes(element.id));
      if (targets.length <= 1) {
        if (targets[0]) get().duplicateElement(targets[0].id);
        return;
      }
      const held = targets.find(isLocked);
      if (held) {
        set({ clash: lockRefusal(held) });
        return;
      }
      /*
       * The group moves together by one offset, so it keeps its arrangement; the first diagonal every
       * copy can take is the one used, and a group with nowhere to go is refused whole.
       */
      const offsets = [
        { x: 1, y: 1 },
        { x: -1, y: 1 },
        { x: 1, y: -1 },
        { x: -1, y: -1 },
      ];
      let names = present.elements;
      for (const offset of offsets) {
        const copies = targets.map((element) => {
          const at = elementAnchor(element);
          return translateTo(element, { x: at.x + offset.x, y: at.y + offset.y });
        });
        if (copies.some((copy) => refusalFor(copy) !== null)) continue;
        const named = copies.map((copy, index) => {
          const next = { ...copy, id: nextElementId(), name: copyName(targets[index]!, names) };
          names = [...names, next];
          return next;
        });
        commit((draft) => ({ ...draft, elements: [...draft.elements, ...named] }));
        set((state) => withSelection(state, named.map((copy) => copy.id)));
        return;
      }
      set({ clash: FENCE_CLASH });
    },

    setMaterialForSelection: (materialId) => {
      const { selectedIds, present } = get();
      const targets = present.elements.filter((element) => selectedIds.includes(element.id));
      if (targets.length === 0) return;
      const category = targets[0]!.category;
      if (targets.some((element) => element.category !== category)) return;
      commit((draft) => ({
        ...draft,
        elements: draft.elements.map((element) =>
          selectedIds.includes(element.id) ? withMaterial(element, materialId) : element,
        ),
      }));
    },

    addElement: (category, at, options = {}) => {
      const centre = options.size ? at : snapped(at);
      const symbol = get().placingSymbol;
      const plantId = get().placingPlantId;
      const plant = plantId ? PLANT_CATALOGUE[plantId] : undefined;

      /*
       * A symbol brings its own footprint — a lounger is 0.7 × 1.9 m whatever category it is —
       * and a round one is placed as a point, the way the generator places a fire pit bowl.
       */
      const footprint = symbol ? SYMBOLS[symbol].footprint : null;
      const size = options.size ?? (footprint?.kind === 'rect' ? footprint : NEW_ELEMENT_SIZE[category]);
      const shape: PlanGeometry =
        footprint?.kind === 'point'
          ? { kind: 'point', at: centre, radius: plant ? plant.spread / 2 : footprint.radius }
          : { kind: 'rect', centre, width: size.width, depth: size.depth, rotation: 0 };

      const id = nextElementId();
      const zones = selectZones({ present: useBoundaryStore.getState().present });

      /*
       * Built before it is checked, rather than after, because what makes a placement legal is a
       * property of the element and not of its outline: `refusalFor` reads the symbol to know
       * whether this point is a canopy over a trunk or a pond.
       */
      const added: DesignElement = {
        id,
        category,
        role: 'feature',
        name: plant?.name ?? (symbol ? SYMBOLS[symbol].label : defaultName(category, get().present.elements)),
        shape,
        zone: zoneAt(centre, zones)?.id ?? 'back',
        material: defaultMaterial(category),
        elevation: 0,
        ...(symbol ? { symbol, height: plant?.height ?? SYMBOLS[symbol].height } : {}),
        ...(plantId ? { plantId } : {}),
      };

      const refusal = refusalFor(added);
      if (refusal) {
        set({ clash: refusal });
        return;
      }

      commit((draft) => ({ ...draft, elements: [...draft.elements, added] }));

      set(
        options.keepArmed
          ? only(id)
          : { ...only(id), placingCategory: null, placingSymbol: null, placingPlantId: null },
      );
      /* Something the generator did not think of. See `state/design-events.ts`. */
      emitDesignEvent('element_added', { elementId: id, category });
    },

    moveElementLive: (id, anchor, options) => {
      const element = get().present.elements.find((candidate) => candidate.id === id);
      if (!element || isLocked(element)) return;

      /* Dragging one member of a selection moves the selection, by the same amount, as one. */
      const { selectedIds } = get();
      const group = selectedIds.length > 1 && selectedIds.includes(id) ? selectedIds : null;

      let target = snapped(anchor);
      let guides: AlignmentGuide[] = [];
      let marker: Point | null = null;

      /*
       * Pull onto what the shape has come close to — a corner onto a corner, a corner onto an edge
       * (which is what puts a patio flush against a house wall however the house is turned), or its
       * box level with a line — and report the guides so the canvas can draw them. Snap first, check
       * second, and never snap into a refusal: a pull that would carry the shape over the fence is
       * passed over for the next, so a shape can still be dragged flush past a guide pointing out.
       *
       * A point — a tree, a light — offers no corners: its centre is not a thing anyone lays against
       * a wall, and pulling a trunk onto the edge of a bed would feel like the tree slipping.
       */
      if (get().snapEnabled) {
        const placed = translateTo(element, target);
        const from = target;
        const result = snapShapeDelta(
          {
            corners: placed.shape.kind === 'point' ? [] : cornersOf(placed.shape).points,
            outline: geometryOutline(placed.shape),
          },
          planTargetsExcluding(group ?? [id]),
          {
            enabled: true,
            threshold: zoomReach(options),
            accept: (delta) =>
              group
                ? true
                : refusalFor(translateTo(element, { x: from.x + delta.x, y: from.y + delta.y })) === null,
          },
        );
        target = { x: from.x + result.delta.x, y: from.y + result.delta.y };
        guides = result.guides;
        marker = result.marker;
      }

      set({ alignments: guides, snapMarker: marker });
      if (group) {
        const at = elementAnchor(element);
        moveGroupLive(group, target.x - at.x, target.y - at.y);
        return;
      }
      const moved = translateTo(element, target);
      applyLive(id, () => moved);
    },

    setPosition: (id, anchor) => {
      if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;
      commitElement(id, (element) => translateTo(element, anchor));
    },

    setCanopyDiameter: (id, metres) => {
      if (!Number.isFinite(metres) || metres < MIN_ELEMENT_SIDE) return;
      commitElement(id, (element) =>
        element.shape.kind === 'point'
          ? { ...element, shape: { ...element.shape, radius: metres / 2 } }
          : element,
      );
    },

    replaceSymbol: (id, symbol, plantId) => {
      const spec = SYMBOLS[symbol];
      const plant = plantId ? PLANT_CATALOGUE[plantId] : undefined;
      if (plantId && (!plant || plant.symbol !== symbol)) return;
      commitElement(id, (element) => {
        if (
          spec.category !== element.category ||
          (isPlantSymbol(symbol) && element.shape.kind !== 'point')
        )
          return element;
        /*
         * A species brings its own size: a switch from a rowan to an oak is a tree three times the
         * height and twice the spread, and keeping the old numbers would draw, shade and count the
         * rowan under the oak's name. A bare type keeps the canopy the user sized and takes the
         * type's height, which is all the type knows.
         */
        const shape =
          plant && element.shape.kind === 'point'
            ? { ...element.shape, radius: plant.spread / 2 }
            : element.shape;
        return {
          ...element,
          symbol,
          plantId,
          shape,
          name: plant?.name ?? spec.label,
          height: plant?.height ?? spec.height,
        };
      });
    },

    setStatus: (id, status) =>
      commitElement(id, (element) => ({ ...element, status }), { checkGeometry: false }),

    resizeElementLive: (id, size, options = {}) =>
      applyLive(id, (element) => {
        if (element.shape.kind !== 'rect') return element;

        /*
         * A side snaps to the decimetre, the unit a garden is measured in — but only a side that is
         * being changed, so dragging the width of a 3.14 m generated terrace does not also round its
         * depth, and only when it has actually moved.
         */
        const unit = useBoundaryStore.getState().unit;
        const tidy = (value: number | undefined, current: number) =>
          value === undefined || value === current || !get().snapEnabled || options.exact
            ? value
            : snapLength(value, unit);
        const wanted = {
          width: Math.max(MIN_ELEMENT_SIDE, tidy(size.width, element.shape.width) ?? element.shape.width),
          depth: Math.max(MIN_ELEMENT_SIDE, tidy(size.depth, element.shape.depth) ?? element.shape.depth),
        };
        // A pergola dragged by its handles stops at the largest one made, as a typed size does.
        const definition = structureDefinitionFor(element);
        const next = definition ? heldToLimits(definition, element.shape, wanted) : wanted;
        return { ...element, shape: { ...element.shape, ...next } };
      }),

    rotateElementLive: (id, degrees, options = {}) =>
      applyLive(id, (element) => {
        if (element.shape.kind !== 'rect') return element;
        /*
         * With snap on, a dragged rotation lands on a 15° step or square to the house — a patio
         * turned 31.7° by hand is never what anybody meant. The house's bearing is the one
         * reference worth offering: it is what a terrace, a path and a pergola are laid square to.
         */
        const normalised = get().snapEnabled && !options.exact
          ? snapRotation(degrees, rotationReferences(element))
          : ((degrees % 360) + 360) % 360;

        return { ...element, shape: { ...element.shape, rotation: normalised } };
      }),

    nudgeSelection: (dx, dy) => {
      const { selectedId, selectedIds } = get();
      if (!selectedId) return;
      moveGroupLive(selectedIds.length > 1 ? selectedIds : [selectedId], dx, dy);
    },

    renameElement: (id, name) =>
      commitElement(id, (element) => ({ ...element, name: name.trim() || element.name }), {
        checkGeometry: false,
      }),

    // Material is the one edit a locked base fill accepts — turning the lawn to gravel is a real
    // decision, and it cannot open a gap in the ground.
    setMaterial: (id, materialId) =>
      commitElement(id, (element) => withMaterial(element, materialId), {
        checkGeometry: false,
      }),

    setEnclosure: (id, patch) =>
      commitElement(id, (element) => {
        if (element.category !== 'enclosure' || element.shape.kind !== 'polyline') return element;
        const kind = patch.kind ?? element.enclosure?.kind ?? 'fence';
        const spec = ENCLOSURE_KINDS[kind];
        const next: DesignElement = { ...element, enclosure: { ...element.enclosure, kind } };
        if (patch.kind && patch.kind !== element.enclosure?.kind) {
          next.shape = { ...element.shape, width: spec.thickness };
          if (!element.material || !spec.materials.includes(element.material)) next.material = spec.material;
          /* A height typed for a fence is not the height of the wall it became. */
          delete next.height;
          next.name = spec.label;
        }
        if (kind !== 'hedge' || patch.plantId === null) delete next.plantId;
        else if (patch.plantId) next.plantId = patch.plantId;
        return next;
      }),

    /*
     * A bed's own mix, or `undefined` to go back to its material's. Normalised on the way in, so a
     * stored mix always sums to a whole bed whatever the panel sent.
     */
    setPlanting: (id, planting) =>
      commitElement(
        id,
        (element) => {
          if (element.category !== 'planting-bed' || element.shape.kind === 'point') return element;
          const next = { ...element };
          const mix = planting ? normalisedMix(planting.mix) : [];
          if (mix.length > 0) next.planting = { mix };
          else delete next.planting;
          return next;
        },
        { checkGeometry: false },
      ),

    /*
     * Like `setMaterial`, this is accepted on a locked base fill: edging the lawn is a real
     * decision and it cannot open a gap in the ground. `''` clears it back to the spade cut, which
     * is why the field is deleted rather than set to an empty string — an empty `edging` would be a
     * material id nothing can resolve, where absent has a meaning.
     */
    setEdging: (id, materialId) =>
      commitElement(
        id,
        (element) => {
          const next = { ...element };
          if (materialId) next.edging = materialId;
          else delete next.edging;
          return next;
        },
        { checkGeometry: false },
      ),

    /* ---- the Edges tab ---- */

    openEdgeEdit: (hostId) =>
      set((state) =>
        state.edgeEdit?.hostId === hostId
          ? state
          : { edgeEdit: { hostId, selectedRunId: null, hoveredRunId: null } },
      ),

    closeEdgeEdit: () => set({ edgeEdit: null }),

    /* ---- the 3D structure editor ---- */

    openStructureEdit: (id) => {
      const element = get().present.elements.find((candidate) => candidate.id === id);
      if (!element || !structureDefinitionFor(element)) return;
      set({
        ...only(id),
        edgeEdit: null,
        clash: null,
        structureEdit: { elementId: id, pieceId: null },
      });
    },

    closeStructureEdit: () => set({ structureEdit: null, clash: null }),

    /*
     * No geometry check, because nothing here can move anything: the configuration has nowhere to
     * put a position or a size. Width and depth go through `setSize`, height through `setHeight`
     * and the frame through `setMaterial` — the same actions the plan's inspector uses.
     */
    setStructure: (id, patch) =>
      commitElement(
        id,
        (element) =>
          structureDefinitionFor(element)
            ? { ...element, structure: mergeStructureConfig(element.structure, patch) }
            : element,
        { checkGeometry: false },
      ),

    // A preset never moves anything, so like `setStructure` it needs no geometry check.
    setStructurePreset: (id, presetId) =>
      commitElement(id, (element) => applyStructurePreset(element, presetId), { checkGeometry: false }),

    resizeStructure: (id, request) => {
      get().beginGesture();
      const result = get().resizeStructureLive(id, request);
      get().endGesture();
      return result;
    },

    resizeStructureLive: (id, request) => {
      const settled = get().gestureSnapshot?.elements ?? get().present.elements;
      const element = settled.find((candidate) => candidate.id === id);
      if (!element) return { status: 'unsupported' };
      const result = planStructureResize(element, request, structureContextNow(settled));
      if (result.status === 'ok') applyLive(id, () => result.element);
      // Nothing was applied, so an older refusal would now describe an edit that did not happen.
      else if (result.status === 'blocked') set({ clash: null });
      return result;
    },

    setStructureHeightLive: (id, metres) =>
      applyLive(id, (element) => {
        const limits = structureDefinitionFor(element)?.dimensions.height;
        const height = limits ? Math.min(limits.max, Math.max(limits.min, metres)) : Math.max(0, metres);
        return element.height === height ? element : { ...element, height };
      }),

    selectPiece: (pieceId) =>
      set((state) => (state.structureEdit ? { structureEdit: { ...state.structureEdit, pieceId } } : state)),

    addPiece: (structureId, symbol) => {
      const structure = get().present.elements.find((item) => item.id === structureId);
      if (!structure) return null;
      const piece = pieceFor(structure, symbol, nextElementId());
      if (!piece) {
        set({ clash: `There is no room for a ${SYMBOLS[symbol].label.toLowerCase()} in it.` });
        return null;
      }
      commit((draft) => ({ ...draft, elements: [...draft.elements, piece] }));
      get().selectPiece(piece.id);
      emitDesignEvent('element_added', { elementId: piece.id, category: 'furniture' });
      return piece.id;
    },

    swapPiece: (pieceId, symbol) => {
      const host = structureOf(get());
      const piece = get().present.elements.find((item) => item.id === pieceId);
      if (!host || !piece) return;
      const swapped = swappedPiece(host, piece, symbol);
      if (!swapped) {
        set({ clash: `A ${SYMBOLS[symbol].label.toLowerCase()} will not fit in it.` });
        return;
      }
      commitElement(pieceId, () => swapped);
    },

    turnPiece: (pieceId) => {
      const host = structureOf(get());
      const piece = get().present.elements.find((item) => item.id === pieceId);
      if (!host || !piece) return;
      const turned = turnedPiece(host, piece);
      if (!turned) {
        set({ clash: 'Turned, it would not fit inside.' });
        return;
      }
      commitElement(pieceId, () => turned);
    },

    movePieceLive: (pieceId, at) => {
      const host = structureOf(get());
      if (!host) return;
      applyLive(pieceId, (piece) => pieceAt(piece, clampInside(host, piece, at)));
    },

    applyStructureCandidate: (id, candidate) => {
      const elements = get().present.elements;
      const element = elements.find((item) => item.id === id);
      if (!element || candidate.id !== id) return false;
      if (structureConflicts(element, candidate, structureContextNow(elements)).length) return false;
      get().beginGesture();
      applyLive(id, () => candidate);
      get().endGesture();
      return true;
    },

    selectEdgeRun: (runId) =>
      set((state) => (state.edgeEdit ? { edgeEdit: { ...state.edgeEdit, selectedRunId: runId } } : state)),

    hoverEdgeRun: (runId) =>
      set((state) =>
        state.edgeEdit && state.edgeEdit.hoveredRunId !== runId
          ? { edgeEdit: { ...state.edgeEdit, hoveredRunId: runId } }
          : state,
      ),

    /*
     * Every edit below is accepted on a locked base fill, as `setMaterial` is: a treatment cannot
     * move anything, so it cannot open a gap in the ground. And every one stamps `source: 'user'`,
     * which is what the next restyle reads to leave it alone.
     */
    setEdgeMode: (id, mode) => {
      commitElement(
        id,
        (element) => {
          const elements = get().present.elements;
          const materialised =
            mode === 'custom'
              ? materialisedRuns(elements, id, resolveEdges(elements, edgeContextNow(), edgeRulesNow()))
              : [];
          return withEdgeMode(element, mode, materialised);
        },
        { checkGeometry: false },
      );
      set((state) =>
        state.edgeEdit?.hostId === id ? { edgeEdit: { ...state.edgeEdit, selectedRunId: null } } : state,
      );
    },

    addEdgeRunAt: (id, side, distance) => {
      const element = get().present.elements.find((candidate) => candidate.id === id);
      if (!element) return null;

      const elements = get().present.elements;
      const resolution = resolveEdges(elements, edgeContextNow(), edgeRulesNow());
      // Adding to a surface still on Auto starts from what Auto was drawing, never from nothing.
      const host =
        edgePlanOf(element).mode === 'custom'
          ? element
          : withEdgeMode(element, 'custom', materialisedRuns(elements, id, resolution));

      const span = freeSpanAt(host, resolution.graph.intervalsOf(id), side, distance);
      if (!span) return null;

      const added = withRunAdded(host, side, span, defaultTreatmentFor(element), 'user');
      if (!added) return null;

      commitElement(id, () => added.element, { checkGeometry: false });
      set((state) =>
        state.edgeEdit?.hostId === id
          ? { edgeEdit: { ...state.edgeEdit, selectedRunId: added.runId } }
          : state,
      );
      return added.runId;
    },

    setEdgeRunEndLive: (id, runId, end, distance) =>
      applyEdgeLive(id, (element) => withRunEnd(element, runId, end, distance)),

    setEdgeRunTreatment: (id, runId, treatment) =>
      commitElement(id, (element) => withRunTreatment(element, runId, treatment, 'user') ?? element, {
        checkGeometry: false,
      }),

    setEdgeRunDimension: (id, runId, dimension, millimetres) =>
      commitElement(
        id,
        (element) => withRunDimension(element, runId, dimension, millimetres, 'user') ?? element,
        { checkGeometry: false },
      ),

    removeEdgeRun: (id, runId) => {
      commitElement(id, (element) => withoutRun(element, runId) ?? element, { checkGeometry: false });
      set((state) =>
        state.edgeEdit?.selectedRunId === runId
          ? { edgeEdit: { ...state.edgeEdit, selectedRunId: null } }
          : state,
      );
    },

    /**
     * The wall a raised surface is held back by. `''` clears it to the plain upstand, which is the
     * default and a real answer — see `WALLING_MATERIALS`.
     */
    setRetaining: (id, materialId) =>
      commitElement(
        id,
        (element) => {
          const next = { ...element };
          if (materialId) next.retaining = materialId;
          else delete next.retaining;
          return next;
        },
        { checkGeometry: false },
      ),

    setZone: (id, zone) =>
      commitElement(id, (element) => ({ ...element, zone }), { checkGeometry: false }),

    setElevation: (id, metres) =>
      commitElement(id, (element) => ({ ...element, elevation: metres }), {
        checkGeometry: false,
      }),

    /*
     * Height changes no geometry — a taller pergola occupies the same footprint — so it skips the
     * check like material and zone do. What it *does* change is the shadow the thing throws, which
     * is the whole reason it is worth exposing: the value has driven `heightFor` since the sun
     * model landed and there has never been anywhere to see or correct it.
     */
    setHeight: (id, metres) =>
      commitElement(id, (element) => ({ ...element, height: Math.max(0, metres) }), {
        checkGeometry: false,
      }),

    toggleHidden: (id) =>
      commitElement(id, (element) => ({ ...element, hidden: !element.hidden }), {
        checkGeometry: false,
      }),

    openVertexEdit: (id) => {
      const element = get().present.elements.find((candidate) => candidate.id === id);
      if (!element || !geometryVertices(element.shape)) return;
      if (isLocked(element)) {
        set({ clash: lockRefusal(element) });
        return;
      }
      set((state) => ({
        ...only(id),
        vertexEdit: { id, selectedIndex: null },
        edgeEdit: null,
        clash: null,
        ...(state.structureEdit ? { structureEdit: null } : {}),
      }));
    },

    closeVertexEdit: () => set({ vertexEdit: null }),

    selectVertex: (index) =>
      set((state) => (state.vertexEdit ? { vertexEdit: { ...state.vertexEdit, selectedIndex: index } } : state)),

    moveVertexLive: (id, index, raw, options) => {
      const element = get().present.elements.find((candidate) => candidate.id === id);
      if (!element) return;
      const points = geometryVertices(element.shape);
      if (!points) return;

      /*
       * The corner lands on what it is near — another corner, a wall, a line something is level
       * with, the grid — and never somewhere the outline would be refused: a snap that would fold
       * the shape or carry it over the fence is passed over for the next.
       */
      const attempt = (at: Point) =>
        withGeometryVertices(
          element.shape,
          points.map((point, at_) => (at_ === index ? at : point)),
        );
      const snap = snapPointTo(raw, planTargetsExcluding([id]), {
        enabled: get().snapEnabled,
        unit: useBoundaryStore.getState().unit,
        threshold: zoomReach(options),
        accept: (at) => {
          const shape = attempt(at);
          return vertexEditRefusal(shape) === null && refusalFor({ ...element, shape }) === null;
        },
      });
      set({ alignments: snap.guides, snapMarker: snap.marker });
      reshapeCorners(id, () => attempt(snap.point), 'live');
    },

    insertVertex: (id, edgeIndex, at) => {
      const inserted = reshapeCorners(
        id,
        (shape) => {
          const points = geometryVertices(shape);
          if (!points) return null;
          if (shape.kind === 'polyline' && edgeIndex >= points.length - 1) return null;
          return withGeometryVertices(shape, [
            ...points.slice(0, edgeIndex + 1),
            { x: at.x, y: at.y },
            ...points.slice(edgeIndex + 1),
          ]);
        },
        'commit',
      );
      if (inserted) get().selectVertex(edgeIndex + 1);
    },

    deleteVertex: (id, index) => {
      const element = get().present.elements.find((candidate) => candidate.id === id);
      if (!element) return;
      const points = geometryVertices(element.shape);
      if (!points) return;
      if (points.length <= minimumGeometryVertices(element.shape)) {
        set({
          clash:
            element.shape.kind === 'polygon'
              ? 'A shape needs at least three corners.'
              : 'A path needs at least two points.',
        });
        return;
      }
      const removed = reshapeCorners(
        id,
        (shape) => withGeometryVertices(shape, points.filter((_, at) => at !== index)),
        'commit',
      );
      if (removed) get().selectVertex(null);
    },

    setCornerRadiusLive: (id, radius) => {
      reshapeCorners(id, (shape) => (shape.kind === 'polygon' ? withCornerRadius(shape, radius) : null), 'live');
    },

    setPathWidth: (id, width) => {
      if (!Number.isFinite(width) || width < MIN_ELEMENT_SIDE) return;
      reshapeCorners(
        id,
        (shape) => (shape.kind === 'polyline' ? { ...shape, width: Math.min(width, 5) } : null),
        'commit',
      );
    },

    setSideLength: (id, edgeIndex, metres) => {
      if (!Number.isFinite(metres) || metres <= 0) return;
      reshapeCorners(
        id,
        (shape) =>
          shape.kind === 'polygon' ? { ...shape, points: reflowEdge(shape.points, edgeIndex, metres) } : null,
        'commit',
      );
    },

    convertToPolygon: (id) => {
      const element = get().present.elements.find((candidate) => candidate.id === id);
      if (!element || !canConvertToPolygon(element) || element.shape.kind !== 'rect') return;
      /*
       * The same four corners in the order `rectToPolygon` gives them, which is the order the side
       * chains number a rectangle's sides in — so every custom edge run stays on the side it was on.
       */
      const points = rectToPolygon(element.shape);
      commitElement(id, (current) => ({ ...current, shape: { kind: 'polygon', points, cornerRadius: 0 } }));
    },

    toggleLocked: (ids) =>
      commit((draft) => {
        const targets = draft.elements.filter(
          (element) => ids.includes(element.id) && !isGroundLayer(element),
        );
        if (targets.length === 0) return null;
        const lock = !targets.every(isUserLocked);
        return {
          ...draft,
          elements: draft.elements.map((element) => {
            if (!targets.includes(element)) return element;
            if (lock) return { ...element, locked: true };
            const { locked: _locked, ...unlocked } = element;
            return unlocked;
          }),
        };
      }),

    duplicateElement: (id) => {
      const element = get().present.elements.find((candidate) => candidate.id === id);
      if (!element || isLocked(element)) {
        if (element) set({ clash: lockRefusal(element) });
        return;
      }

      /*
       * Offset by a metre so the copy is visible rather than exactly behind the original — down and
       * right first, then the other three diagonals, because a bench against the right-hand fence
       * has nowhere to go down and right and the copy would be refused for a reason nobody chose.
       */
      const at = elementAnchor(element);
      const copyId = nextElementId();
      const name = copyName(element, get().present.elements);
      const offsets = [
        { x: 1, y: 1 },
        { x: -1, y: 1 },
        { x: 1, y: -1 },
        { x: -1, y: -1 },
      ];
      let copy: DesignElement | null = null;
      let refusal: string | null = null;
      for (const offset of offsets) {
        const candidate: DesignElement = {
          ...translateTo(element, { x: at.x + offset.x, y: at.y + offset.y }),
          id: copyId,
          name,
        };
        refusal = refusalFor(candidate);
        if (!refusal) {
          copy = candidate;
          break;
        }
      }

      if (!copy) {
        set({ clash: refusal });
        return;
      }

      commit((draft) => ({ ...draft, elements: [...draft.elements, copy] }));
      set(only(copy.id));
    },

    deleteElement: (id) => {
      const element = get().present.elements.find((candidate) => candidate.id === id);
      if (!element) return;

      if (isLocked(element)) {
        set({ clash: lockRefusal(element) });
        return;
      }

      commit((draft) => ({
        ...draft,
        elements: draft.elements.filter((candidate) => candidate.id !== id),
      }));
      set((state) => ({
        ...withSelection(
          state,
          state.selectedIds.filter((candidate) => candidate !== id),
        ),
        structureEdit:
          state.structureEdit?.elementId === id
            ? null
            : state.structureEdit?.pieceId === id
              ? { ...state.structureEdit, pieceId: null }
              : state.structureEdit,
      }));
      /*
       * The most informative event there is: the generator put something here and a person took it
       * straight back out. Recorded with the category rather than the name, because "people delete
       * the structure on this composition" is a fact about the design and "people delete Garden
       * store 2" is not.
       */
      emitDesignEvent('element_deleted', { elementId: id, category: element.category });
    },

    /*
     * One undo entry per gesture, not one per frame. A drag calls `moveElementLive` on every
     * mousemove and each of those commits, so without this a single drag would leave forty
     * entries on the stack. The snapshot taken here is what the whole gesture collapses to.
     *
     * The same bracket is what makes an applied AI diff a single undo step.
     */
    beginGesture: () => {
      gestureTargets = null;
      set((state) => ({ gestureSnapshot: state.present }));
    },

    setSize: (id, size) => {
      get().beginGesture();
      get().resizeElementLive(id, size, { exact: true });
      get().endGesture();
    },

    endGesture: (options = {}) =>
      set((state) => {
        const snapshot = state.gestureSnapshot;
        // The guides only mean anything mid-gesture.
        if (!snapshot) return { gestureSnapshot: null, alignments: [], snapMarker: null };
        if (sameElements(snapshot, state.present))
          return { gestureSnapshot: null, alignments: [], snapMarker: null };

        /*
         * One event per gesture, which is the same unit the undo stack uses and for the same
         * reason: a drag calls `moveElementLive` on every mousemove, and forty rows saying a shed
         * moved two centimetres describe the mouse rather than the decision. What is recorded is
         * what the gesture *did* — see `gestureChange`.
         *
         * `silent` is for a caller that reports its own event. An AI run is one gesture containing
         * a dozen decisions, and `gestureChange` would either say nothing (several elements moved)
         * or — worse, on a one-operation run — file it as a person moving a shed by hand. The
         * table's whole value is that it records what *people* did with the design.
         */
        const change = options.silent ? null : gestureChange(snapshot.elements, state.present.elements);
        if (change) emitDesignEvent(change.kind, change.detail);

        return {
          gestureSnapshot: null,
          alignments: [],
          snapMarker: null,
          past: [...state.past, snapshot].slice(-HISTORY_LIMIT),
          future: [],
          lastSavedAt: Date.now(),
        };
      }),

    /**
     * Records a redesign so it can be undone after a reload.
     *
     * Deliberately not a history entry of its own: the run's gesture bracket already wrote one, and
     * this is the copy that outlives the tab. `before` is the garden the sentence started from, and
     * `afterFingerprint` is how a reloaded session tells "still what the designer left" from "edited
     * since".
     */
    recordRevision: (record) => set({ revision: record }),

    /**
     * Puts the plan back to before the last redesign, whether or not this is the same session.
     *
     * In-session, Undo does the same thing and does it through the history stack. This is for the
     * case that stack cannot reach: the user reloaded, or came back the next day, and the redesign
     * is the thing they want gone. It commits like any other edit, so it is itself undoable.
     */
    undoRevision: () => {
      const { revision, present } = get();
      if (!revision) return;
      if (layoutFingerprint(present.elements) !== revision.afterFingerprint) return;

      commit((draft) => ({ ...draft, elements: revision.before }));
      set({ revision: null, ...only(null) });
    },

    undo: () =>
      set((state) => {
        const previous = state.past.at(-1);
        if (!previous) return state;

        return {
          past: state.past.slice(0, -1),
          present: previous,
          future: [state.present, ...state.future].slice(0, HISTORY_LIMIT),
          clash: null,
          ...historySelection(state, previous),
        };
      }),

    redo: () =>
      set((state) => {
        const [next, ...rest] = state.future;
        if (!next) return state;

        return {
          past: [...state.past, state.present].slice(-HISTORY_LIMIT),
          present: { ...next, elements: associatePlants(next.elements) },
          future: rest,
          clash: null,
          ...historySelection(state, next),
        };
      }),

    resetToConcept: () => {
      /* Everything the person changed, thrown away: the strongest signal an editor can give. */
      emitDesignEvent('layout_reset');
      set((state) => {
        if (!state.pristine) return state;

        return {
          past: [...state.past, state.present].slice(-HISTORY_LIMIT),
          present: { elements: state.pristine },
          future: [],
          ...only(null),
          clash: null,
          lastSavedAt: Date.now(),
        };
      });
    },

    toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled, alignments: [] })),
    /*
     * No companion clear, unlike `toggleSnap` — turning snapping off has to drop any guides
     * currently flashing, but the grid owns nothing else.
     */
    toggleGrid: () => set((state) => ({ gridVisible: !state.gridVisible })),

    toggleShadows: () => set((state) => ({ shadowsVisible: !state.shadowsVisible })),


    toggleLabels: () => set((state) => ({ labelsVisible: !state.labelsVisible })),

    toggleZones: () => set((state) => ({ zonesVisible: !state.zonesVisible })),

    toggleDimensions: () => set((state) => ({ dimensionsVisible: !state.dimensionsVisible })),

    toggleGroup: (group) =>
      set((state) => {
        const hiding = !state.hiddenGroups.includes(group);
        const hiddenGroups = hiding
          ? [...state.hiddenGroups, group]
          : state.hiddenGroups.filter((candidate) => candidate !== group);
        /* A selection nobody can see is a selection Delete would act on blind: the hidden members go. */
        const kept = hiding
          ? state.selectedIds.filter((id) => {
              const element = state.present.elements.find((candidate) => candidate.id === id);
              return element !== undefined && viewGroupOf(element) !== group;
            })
          : state.selectedIds;
        return { hiddenGroups, ...(kept.length === state.selectedIds.length ? {} : withSelection(state, kept)) };
      }),

    setMode: (mode) =>
      set({
        mode,
        placingCategory: null,
        placingSymbol: null,
        placingPlantId: null,
        placingEnclosure: null,
        draftPoints: [],
        measurement: null,
        clash: null,
      }),

    setPlacing: (category, symbol = null, plantId = null) =>
      set((state) => ({
        placingCategory: category,
        placingSymbol: symbol,
        placingPlantId: plantId,
        placingEnclosure: null,
        draftPoints: [],
        /* A path is only offered for paving and gravel; switching to anything else drops back. */
        placingTool:
          state.placingTool === 'polyline' && category !== 'paved-area' && category !== 'gravel-mulch'
            ? 'rect'
            : state.placingTool,
        mode: 'select',
        clash: null,
      })),

    setPlacingEnclosure: (kind) =>
      set({
        placingCategory: kind ? 'enclosure' : null,
        placingSymbol: null,
        placingPlantId: null,
        placingEnclosure: kind,
        placingTool: kind ? 'polyline' : 'rect',
        draftPoints: [],
        mode: 'select',
        clash: null,
      }),

    setPlacingTool: (tool) => set({ placingTool: tool, draftPoints: [], clash: null }),

    previewDraftPoint: (raw, options) => draftSnap(raw, get().draftPoints, options),

    addDraftPoint: (raw, options = {}) => {
      const { placingTool, draftPoints } = get();
      if (placingTool === 'rect') return 'ignored';
      const step = draftStep(draftPoints, raw, placingTool, (at, points) => draftSnap(at, points, options));
      if (step.kind === 'close') {
        get().finishDraft(options);
        return 'closed';
      }
      if (step.kind === 'ignore') return 'ignored';
      set({ draftPoints: [...draftPoints, step.point], clash: null });
      return 'added';
    },

    finishDraft: (options = {}) => {
      const { placingCategory, placingTool, draftPoints, placingEnclosure } = get();
      if (!placingCategory || placingTool === 'rect') return;
      /* A fence is drawn at its own thickness — a line of the kind's width, not a path's. */
      const kind = placingCategory === 'enclosure' ? (placingEnclosure ?? 'fence') : null;
      const shape = finishedGeometry(draftPoints, placingTool, kind ? ENCLOSURE_KINDS[kind].thickness : DRAWN_PATH_WIDTH);
      if (!shape) {
        set({
          clash:
            placingTool === 'polygon'
              ? 'A shape needs at least three corners, and must not cross itself.'
              : kind
                ? 'A line needs at least two points, half a metre apart.'
                : 'A path needs at least two points, half a metre apart.',
        });
        return;
      }
      const extra: Partial<DesignElement> = kind
        ? {
            enclosure: { kind },
            material: ENCLOSURE_KINDS[kind].material,
            name: ENCLOSURE_KINDS[kind].label,
          }
        : {};
      if (addDrawnElement(placingCategory, shape, extra)) {
        set(
          options.keepArmed
            ? { draftPoints: [] }
            : {
                draftPoints: [],
                placingCategory: null,
                placingSymbol: null,
                placingPlantId: null,
                placingEnclosure: null,
                ...(kind ? { placingTool: 'rect' as const } : {}),
              },
        );
      }
    },

    cancelDraft: () => set({ draftPoints: [], clash: null }),

    addMeasurePoint: (raw, options) => {
      const point = snappedPointer(raw, options);
      set((state) => {
        if (!state.measurement || state.measurement.to)
          return { measurement: { from: point, to: null } };
        return { measurement: { ...state.measurement, to: point } };
      });
    },

    trackMeasurePointer: (raw, options) => {
      const point = snappedPointer(raw, options);
      set((state) =>
        state.measurement && !state.measurement.to
          ? { measurement: { ...state.measurement, to: point } }
          : state,
      );
    },

    clearMeasurement: () => set({ measurement: null }),

    clearClash: () => set({ clash: null }),

    /**
     * The AI assistant's only route into the layout.
     *
     * Every accepted line is re-validated here against the live house and boundary. The proposal
     * was checked when it was built, but the plan may have moved on since — the user could have
     * dragged something under it, or applied an earlier message. **The store is the authority on
     * what is legal, not the thing that proposed it.** Refused lines are reported back so the
     * chat can say what did not land rather than silently dropping it.
     *
     * The whole diff sits inside one gesture bracket, so it costs exactly one Undo however many
     * lines it carried.
     */
    applyProposal: (changes, acceptedIds, options = {}) => {
      const outcome: ApplyOutcome = { applied: [], refused: [] };
      const accepted = changes.filter((change) => acceptedIds.includes(change.id));
      if (accepted.length === 0) return outcome;

      const boundary = boundaryNow();

      const nested = options.withinGesture === true;
      if (!nested) get().beginGesture();

      for (const change of accepted) {
        const draft = get().present;

        if (change.kind === 'add') {
          if (!elementIsLegal(change.next, boundary)) {
            outcome.refused.push({ changeId: change.id, reason: FENCE_CLASH });
            continue;
          }

          const added = { ...change.next, id: nextElementId() };
          set({ present: { ...draft, elements: [...draft.elements, added] } });
          outcome.applied.push(change.id);
          continue;
        }

        const existing = draft.elements.find((element) => element.id === change.elementId);
        if (!existing) {
          outcome.refused.push({
            changeId: change.id,
            reason: 'That element is no longer on the plan.',
          });
          continue;
        }

        if (change.kind === 'remove') {
          if (isLocked(existing)) {
            outcome.refused.push({ changeId: change.id, reason: lockRefusal(existing) });
            continue;
          }

          set({
            present: {
              ...draft,
              elements: draft.elements.filter((element) => element.id !== existing.id),
            },
          });
          outcome.applied.push(change.id);
          continue;
        }

        // A material or an edge treatment cannot move anything, so neither answers to the geometry.
        const movesGeometry = change.kind !== 'material' && change.kind !== 'edge';

        /*
         * A user's lock holds against the designer entirely — its material and its edging too. Only
         * the ground layer's lock is about geometry alone, because turning the lawn to gravel is the
         * edit a base fill exists to accept.
         */
        if ((movesGeometry && isLocked(existing)) || isUserLocked(existing)) {
          outcome.refused.push({ changeId: change.id, reason: lockRefusal(existing) });
          continue;
        }

        if (movesGeometry && !elementIsLegal(change.next, boundary)) {
          outcome.refused.push({ changeId: change.id, reason: FENCE_CLASH });
          continue;
        }

        // Keep the element's identity; take only what the change actually alters.
        const merged: DesignElement = { ...existing, ...change.next, id: existing.id };

        set({
          present: {
            ...draft,
            elements: draft.elements.map((element) =>
              element.id === existing.id ? merged : element,
            ),
          },
        });
        outcome.applied.push(change.id);
      }

      if (!nested) get().endGesture();
      if (outcome.applied.length > 0) set({ lastSavedAt: Date.now() });

      return outcome;
    },
  };
});

/**
 * What a finished gesture actually did, as one event.
 *
 * Reported only when exactly one element changed, and that restriction is the point rather than a
 * simplification: a gesture that moved several things is a selection drag or an applied assistant
 * diff, and "three things moved by various amounts" is not a fact anybody can act on. One element
 * moving 1.8 m is.
 *
 * Move and resize are told apart by which part of the geometry changed, because that is what the
 * user was doing — the handles are different, and a resize that also nudges the centre is still a
 * resize. `delta` is metres for a move and the linear factor for a resize.
 */
function gestureChange(
  before: DesignElement[],
  after: DesignElement[],
): { kind: 'element_moved' | 'element_resized'; detail: Omit<DesignEvent, 'kind'> } | null {
  if (before.length !== after.length) return null;

  const changed = after.filter((element, index) => {
    const other = before[index];
    return (
      other?.id === element.id && JSON.stringify(other.shape) !== JSON.stringify(element.shape)
    );
  });
  if (changed.length !== 1) return null;

  const element = changed[0]!;
  const was = before.find((candidate) => candidate.id === element.id);
  if (!was) return null;

  const wasSize = spanOf(was.shape);
  const nowSize = spanOf(element.shape);
  if (wasSize !== null && nowSize !== null && Math.abs(nowSize - wasSize) > 1e-6) {
    return {
      kind: 'element_resized',
      detail: {
        elementId: element.id,
        category: element.category,
        delta: Number((nowSize / Math.max(wasSize, 1e-6)).toFixed(3)),
      },
    };
  }

  const from = anchorOf(was.shape);
  const to = anchorOf(element.shape);
  const moved = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
  if (moved <= 1e-6) return null;

  return {
    kind: 'element_moved',
    detail: {
      elementId: element.id,
      category: element.category,
      delta: Number(moved.toFixed(2)),
    },
  };
}

/** Where a shape sits, for the two kinds that have a single anchor. Null for a polyline. */
function anchorOf(shape: PlanGeometry): Point | null {
  if (shape.kind === 'rect') return shape.centre;
  if (shape.kind === 'point') return shape.at;
  return null;
}

/** One number standing for how big a shape is, so a resize can be told from a move. */
function spanOf(shape: PlanGeometry): number | null {
  if (shape.kind === 'rect') return Math.hypot(shape.width, shape.depth);
  if (shape.kind === 'point') return shape.radius;
  return null;
}

/** Whether two layouts describe the same garden — the test a drag uses to earn a history entry. */
function sameElements(a: PlanEditorDraft, b: PlanEditorDraft): boolean {
  if (a.elements.length !== b.elements.length) return false;

  return a.elements.every((element, index) => {
    const other = b.elements[index];
    return (
      element.id === other.id &&
      element.name === other.name &&
      element.category === other.category &&
      element.material === other.material &&
      element.zone === other.zone &&
      element.elevation === other.elevation &&
      element.hidden === other.hidden &&
      element.locked === other.locked &&
      element.edging === other.edging &&
      element.height === other.height &&
      element.symbol === other.symbol &&
      element.plantId === other.plantId &&
      JSON.stringify(element.planting ?? null) === JSON.stringify(other.planting ?? null) &&
      JSON.stringify(element.enclosure ?? null) === JSON.stringify(other.enclosure ?? null) &&
      JSON.stringify(element.structure ?? null) === JSON.stringify(other.structure ?? null) &&
      JSON.stringify(element.shape) === JSON.stringify(other.shape) &&
      /*
       * Anything a drag can touch has to be in this comparison. An edge handle drags a run without
       * moving the outline, so without this a whole drag ended as "nothing changed" and left no undo
       * entry — the trap CLAUDE.md records for `sameDraft` on step 1, arriving on step 5.
       */
      JSON.stringify(element.edges ?? null) === JSON.stringify(other.edges ?? null)
    );
  });
}

/* ---------------------------------------------------------------- derived reads */

export function selectedElement(state: {
  present: PlanEditorDraft;
  selectedId: string | null;
}): DesignElement | null {
  return state.present.elements.find((element) => element.id === state.selectedId) ?? null;
}

/**
 * What the canvas draws: everything the eye toggle has not hidden, in stacking order.
 *
 * **Not a store selector.** It builds a new array every call, and Zustand v5 reads through
 * `useSyncExternalStore`, which compares snapshots by identity — passing this to the hook spins
 * the render loop until the tab dies. Read `state.present.elements` through the hook and filter
 * with this in a `useMemo`.
 */
export function visibleElements(state: { present: PlanEditorDraft }): DesignElement[] {
  return state.present.elements.filter((element) => !element.hidden);
}

/** Where a click landed, for the measure tape and for placing. */
export function centreOf(element: DesignElement): Point {
  const { shape } = element;
  if (shape.kind === 'point') return shape.at;
  if (shape.kind === 'rect') return shape.centre;
  return polygonCentroid(shape.points);
}

function ephemeralState() {
  return {
    past: [] as PlanEditorDraft[],
    future: [] as PlanEditorDraft[],
    mode: 'select' as PlanEditorMode,
    selectedId: null as string | null,
    selectedIds: [] as string[],
    marquee: null as { start: Point; current: Point } | null,
    placingCategory: null as ElementCategory | null,
    placingSymbol: null as SymbolId | null,
    placingPlantId: null as string | null,
    placingEnclosure: null as EnclosureKind | null,
    placingTool: 'rect' as PlacingTool,
    draftPoints: [] as Point[],
    snapEnabled: true,
    gridVisible: false,
    shadowsVisible: true,
    labelsVisible: false,
    zonesVisible: false,
    dimensionsVisible: false,
    hiddenGroups: [] as ViewGroup[],
    alignments: [] as AlignmentGuide[],
    snapMarker: null as Point | null,
    measurement: null,
    clash: null as string | null,
    gestureSnapshot: null as PlanEditorDraft | null,
    edgeEdit: null as EdgeEditState | null,
    structureEdit: null as StructureEditState | null,
    vertexEdit: null as VertexEditState | null,
  };
}

export function resetPlanEditorStoreForTests(): void {
  elementCounter = 0;

  usePlanEditorStore.setState({
    ...ephemeralState(),
    present: emptyDraft(),
    seededFrom: null,
    pristine: null,
    revision: null,
    lastSavedAt: Date.now(),
  });
}

/**
 * Loads the stored layout.
 *
 * `pristine` comes back with it, which is the whole reason it is in the document rather than
 * derived: "Reset to concept" has to work after a reload, and the concept it came from may since
 * have been regenerated into something else.
 *
 * The counter is re-seeded from `e-N` ids only, anchored. Generated concept elements are named
 * `c17-0-e3` and `c17-keep-f2`; an unanchored pattern would match the digits in those and skew
 * the counter, and because concept ids are namespaced by seed they can never collide with `e-N`
 * anyway.
 */
export function hydratePlanEditorStore(section: LayoutSection, savedAt: number): void {
  elementCounter = highestId(
    section.elements.map((element) => element.id),
    /^e-(\d+)$/,
  );

  usePlanEditorStore.setState({
    ...ephemeralState(),
    present: { elements: section.elements },
    seededFrom: section.seededFrom,
    pristine: section.pristine,
    revision: section.revision,
    lastSavedAt: savedAt,
  });
}
