'use client';

import { create } from 'zustand';
import type { FeaturesSection, Point } from '@garden-studio/schema';
import { draftPolygon } from '@/lib/boundary-geometry';
import { highestId } from '@/lib/hydration';
import {
  defaultFeatureName,
  featureAnchor,
  featureBounds,
  featureIsLegal,
  featureOutline,
  featureVertices,
  FEATURE_DEFINITIONS,
  minimumDraftPoints,
  minimumVertices,
  moveFeature,
  resizeFeature,
  rotateFeature,
  setCornerRadius as applyCornerRadius,
  translateFeature,
  withVertices,
  type FeatureKind,
  type FeatureStatus,
  type PlacedFeature,
} from '@/lib/features';
import { snapPoint } from '@/lib/grid';
import {
  alignmentGuidesFor,
  boxSnapLines,
  collectSnapTargets,
  cornerSnapLines,
  snapDeltaToTargets,
  type AlignmentGuide,
  type SnapTargets,
} from '@/lib/guides';
import { housePolygon } from '@/lib/house';
import { useBoundaryStore } from './boundary-store';

/**
 * Step 2's editor state: what is already in the garden, and what happens to it.
 *
 * Deliberately a second store rather than more fields on `boundary-store`. The undoable thing
 * here is the list of features, and step 2's Undo must not rewind the property the user drew in
 * step 1 — one history stack over both would make the Undo button mean different things
 * depending on which screen you were looking at.
 *
 * The dependency runs one way only: this store reads the boundary store (for the house, the plot
 * outline, and the unit that snapping works in), never the reverse.
 */

export type FeaturesMode = 'select' | 'place' | 'measure';

/** Clicking this close to the first point closes a polygon, in metres. Matches the boundary. */
export const CLOSE_DISTANCE = 0.6;

/** Deep enough to undo a session's worth of fiddling without unbounded growth. */
const HISTORY_LIMIT = 50;

/** Arrow-key nudge in metres; Shift makes it a whole metre. */
export const NUDGE = 0.1;

const HOUSE_CLASH = 'That overlaps the house. Place it on the garden instead.';
const FENCE_CLASH = 'That goes over the property boundary.';

let featureCounter = 0;
function nextFeatureId(): string {
  featureCounter += 1;
  return `f${featureCounter}`;
}

export interface FeaturesDraft {
  features: PlacedFeature[];
}

function initialDraft(): FeaturesDraft {
  return { features: [] };
}

interface FeaturesState {
  past: FeaturesDraft[];
  present: FeaturesDraft;
  future: FeaturesDraft[];

  /*
   * Ephemeral. Outside the history stack for the same reason the boundary store keeps its
   * tools out: undo should rewind the garden, not which palette button was last pressed.
   */
  mode: FeaturesMode;
  placingKind: FeatureKind | null;
  /** Points clicked so far while drawing a polygon or a line. */
  draftPoints: Point[];
  selectedIds: string[];
  /** The one feature whose vertices are currently draggable, if any. */
  editingShapeId: string | null;
  /** Marquee drag in world metres, while the pointer is down on empty canvas. */
  marquee: { start: Point; current: Point } | null;
  /** Snap lines matched during the current gesture. Never persisted, never in history. */
  alignments: AlignmentGuide[];
  snapEnabled: boolean;
  measurement: { from: Point; to: Point | null } | null;
  /** Set when an edit was refused. Cleared on the next action. */
  clash: string | null;
  /** "Nothing to add" was ticked. Recorded for step 3; never blocks Continue. */
  skipped: boolean;
  lastSavedAt: number;
  gestureSnapshot: FeaturesDraft | null;

  startPlacing: (kind: FeatureKind) => void;
  cancelPlacing: () => void;
  placePointAt: (point: Point) => void;
  placeRectangle: (centre: Point, width: number, depth: number) => void;
  addDraftPoint: (point: Point) => void;
  finishDraft: () => void;

  moveFeatureLive: (id: string, anchor: Point) => void;
  nudgeSelection: (dx: number, dy: number) => void;
  deleteFeature: (id: string) => void;
  deleteSelection: () => void;
  setStatus: (id: string, status: FeatureStatus) => void;
  setSelectionStatus: (status: FeatureStatus) => void;
  setReplaceWith: (id: string, text: string) => void;
  renameFeature: (id: string, name: string) => void;

  setEditingShape: (id: string | null) => void;
  moveVertexLive: (id: string, index: number, at: Point) => void;
  insertVertex: (id: string, edgeIndex: number, at: Point) => void;
  deleteVertex: (id: string, index: number) => void;
  resizeFeatureLive: (id: string, size: Partial<{ width: number; depth: number }>) => void;
  rotateFeatureLive: (id: string, degrees: number) => void;
  setCornerRadius: (id: string, radius: number) => void;

  select: (id: string | null, options?: { additive?: boolean }) => void;
  selectMany: (ids: string[]) => void;
  beginMarquee: (at: Point) => void;
  trackMarquee: (at: Point) => void;
  commitMarquee: () => void;

  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  resetFeatures: () => void;

  toggleSnap: () => void;
  addMeasurePoint: (point: Point) => void;
  trackMeasurePointer: (point: Point) => void;
  clearMeasurement: () => void;

  setMode: (mode: FeaturesMode) => void;
  setSkipped: (skipped: boolean) => void;
}

/** The house as a world-space polygon, or null before one has been placed. */
function housePolygonNow(): Point[] | null {
  const house = useBoundaryStore.getState().present.house;
  return house ? housePolygon(house) : null;
}

/** The plot outline the features have to stay inside. */
function boundaryNow(): Point[] {
  return draftPolygon(useBoundaryStore.getState().present);
}

/** Why an edit was refused, or null if it is fine. */
function refusalFor(feature: PlacedFeature): string | null {
  const house = housePolygonNow();
  const boundary = boundaryNow();

  if (featureIsLegal(feature, house, boundary)) return null;
  return featureIsLegal(feature, house, []) ? FENCE_CLASH : HOUSE_CLASH;
}

export const useFeaturesStore = create<FeaturesState>((set, get) => {
  /** Pushes the current draft onto the undo stack and replaces it with the mutated one. */
  function commit(mutate: (draft: FeaturesDraft) => FeaturesDraft | null) {
    set((state) => {
      const next = mutate(state.present);
      if (!next || next === state.present) return state;

      return {
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: next,
        // Branching off an undone state discards the abandoned future.
        future: [],
        lastSavedAt: Date.now(),
        clash: null,
      };
    });
  }

  /** Rounds a pointer position to the snap step, when snapping is on. */
  function snapped(point: Point): Point {
    if (!get().snapEnabled) return point;
    return snapPoint(point, useBoundaryStore.getState().unit);
  }

  /**
   * Everything a dragged shape can line itself up with: the plot's corners, the house's edges
   * and middle, and the same three lines from every other feature. The features being dragged
   * are excluded, or a shape would snap to where it already is.
   */
  function snapTargetsExcluding(ids: string[]): SnapTargets {
    const house = housePolygonNow();
    const sources: SnapTargets[] = [cornerSnapLines(boundaryNow())];

    if (house) sources.push(boxSnapLines(house));

    for (const feature of get().present.features) {
      if (ids.includes(feature.id)) continue;
      sources.push(boxSnapLines(featureOutline(feature)));
    }

    return collectSnapTargets(sources);
  }

  /** Replaces one feature, refusing the change outright if the result is illegal. */
  function commitFeature(id: string, mutate: (feature: PlacedFeature) => PlacedFeature) {
    let refusal: string | null = null;

    commit((draft) => {
      const feature = draft.features.find((candidate) => candidate.id === id);
      if (!feature) return null;

      const next = mutate(feature);
      if (next === feature) return null;

      // A reshape, resize or rotation has no meaningful partial version, so an impossible one
      // is refused rather than half-applied — the same call the house makes.
      refusal = refusalFor(next);
      if (refusal) return null;

      return {
        ...draft,
        features: draft.features.map((candidate) => (candidate.id === id ? next : candidate)),
      };
    });

    if (refusal) set({ clash: refusal });
  }

  /** A frame of a drag: no history entry, and an illegal result is dropped rather than clamped. */
  function applyLive(id: string, mutate: (feature: PlacedFeature) => PlacedFeature) {
    set((state) => {
      const feature = state.present.features.find((candidate) => candidate.id === id);
      if (!feature) return state;

      const next = mutate(feature);
      if (refusalFor(next)) return state;

      return {
        present: {
          ...state.present,
          features: state.present.features.map((candidate) =>
            candidate.id === id ? next : candidate,
          ),
        },
      };
    });
  }

  /**
   * Adds a feature, unless it would sit on the house or hang over the fence. A rejected
   * placement commits nothing and leaves a message for the canvas to show — half-placing it, or
   * silently dropping it, both read as the canvas being broken.
   */
  function addFeature(kind: FeatureKind, geometry: PlacedFeature['geometry']) {
    const feature: PlacedFeature = {
      id: nextFeatureId(),
      kind,
      name: defaultFeatureName(kind, get().present.features),
      geometry,
      // Most of what is already in a garden is staying, so Keep is the default and Remove and
      // Replace are things the user says on purpose.
      status: 'keep',
      replaceWith: null,
    };

    const refusal = refusalFor(feature);
    if (refusal) {
      set({ clash: refusal, draftPoints: [] });
      return;
    }

    commit((draft) => ({ ...draft, features: [...draft.features, feature] }));
    set({ selectedIds: [feature.id], mode: 'select', placingKind: null, draftPoints: [] });
  }

  return {
    past: [],
    present: initialDraft(),
    future: [],

    mode: 'select',
    placingKind: null,
    draftPoints: [],
    selectedIds: [],
    editingShapeId: null,
    marquee: null,
    alignments: [],
    snapEnabled: true,
    measurement: null,
    clash: null,
    skipped: false,
    lastSavedAt: Date.now(),
    gestureSnapshot: null,

    startPlacing: (kind) =>
      set({
        mode: 'place',
        placingKind: kind,
        draftPoints: [],
        selectedIds: [],
        editingShapeId: null,
        measurement: null,
        clash: null,
      }),

    cancelPlacing: () => set({ mode: 'select', placingKind: null, draftPoints: [], clash: null }),

    placePointAt: (raw) => {
      const kind = get().placingKind;
      if (!kind) return;

      const definition = FEATURE_DEFINITIONS[kind];
      if (definition.placement !== 'point') return;

      addFeature(kind, { kind: 'point', at: snapped(raw), radius: definition.size.radius ?? 0.5 });
    },

    placeRectangle: (rawCentre, width, depth) => {
      const kind = get().placingKind;
      if (!kind) return;
      if (FEATURE_DEFINITIONS[kind].placement !== 'rect') return;

      addFeature(kind, { kind: 'rect', centre: snapped(rawCentre), width, depth, rotation: 0 });
    },

    addDraftPoint: (raw) => {
      const { placingKind, draftPoints } = get();
      if (!placingKind) return;

      const placement = FEATURE_DEFINITIONS[placingKind].placement;
      if (placement !== 'polygon' && placement !== 'polyline') return;

      const point = snapped(raw);
      const first = draftPoints[0];

      // Clicking back onto the first point is how a polygon closes, exactly as the boundary
      // does it.
      if (
        placement === 'polygon' &&
        first &&
        draftPoints.length >= minimumDraftPoints('polygon') &&
        Math.hypot(point.x - first.x, point.y - first.y) <= CLOSE_DISTANCE
      ) {
        get().finishDraft();
        return;
      }

      // A double click — how a line says it is finished — fires two clicks first. Dropping a
      // repeat of the last point keeps that from leaving a stray duplicate on the shape.
      const last = draftPoints.at(-1);
      if (last && last.x === point.x && last.y === point.y) return;

      set({ draftPoints: [...draftPoints, point], clash: null });
    },

    finishDraft: () => {
      const { placingKind, draftPoints } = get();
      if (!placingKind) return;

      const definition = FEATURE_DEFINITIONS[placingKind];
      if (draftPoints.length < minimumDraftPoints(definition.placement)) return;

      if (definition.placement === 'polygon') {
        addFeature(placingKind, { kind: 'polygon', points: draftPoints, cornerRadius: 0 });
        return;
      }

      if (definition.placement === 'polyline') {
        addFeature(placingKind, {
          kind: 'polyline',
          points: draftPoints,
          width: definition.size.width ?? 1,
        });
      }
    },

    /*
     * One drag frame. Snapping runs grid first, then alignment, because lining an edge up with
     * another feature is a stronger intent than landing on a half-metre — the same order the
     * house uses on step 1.
     *
     * When several features are selected, the whole selection moves by the delta this one
     * would have moved by. That is all-or-nothing: if any member would end up illegal the frame
     * is dropped, so relative positions can never drift apart.
     */
    moveFeatureLive: (id, rawAnchor) => {
      const state = get();
      const feature = state.present.features.find((candidate) => candidate.id === id);
      if (!feature) return;

      const moving = state.selectedIds.includes(id) ? state.selectedIds : [id];

      let anchor = state.snapEnabled
        ? snapPoint(rawAnchor, useBoundaryStore.getState().unit)
        : rawAnchor;

      let alignments: AlignmentGuide[] = [];

      if (state.snapEnabled) {
        const targets = snapTargetsExcluding(moving);
        const proposed = featureOutline(moveFeature(feature, anchor));
        const delta = snapDeltaToTargets(proposed, targets);

        anchor = { x: anchor.x + delta.x, y: anchor.y + delta.y };
        alignments = alignmentGuidesFor(featureOutline(moveFeature(feature, anchor)), targets);
      }

      const from = moveFeature(feature, anchor);

      // The delta this drag applies, taken from the dragged feature and shared by the rest.
      const origin = featureAnchor(feature);
      const dx = anchor.x - origin.x;
      const dy = anchor.y - origin.y;

      const house = housePolygonNow();
      const boundary = boundaryNow();

      const moved = state.present.features.map((candidate) =>
        moving.includes(candidate.id)
          ? candidate.id === id
            ? from
            : translateFeature(candidate, dx, dy)
          : candidate,
      );

      if (
        moved.some(
          (candidate) =>
            moving.includes(candidate.id) && !featureIsLegal(candidate, house, boundary),
        )
      ) {
        return;
      }

      set({ present: { ...state.present, features: moved }, alignments });
    },

    nudgeSelection: (dx, dy) => {
      const { selectedIds } = get();
      if (selectedIds.length === 0) return;

      let refusal: string | null = null;

      commit((draft) => {
        const house = housePolygonNow();
        const boundary = boundaryNow();

        const moved = draft.features.map((feature) =>
          selectedIds.includes(feature.id) ? translateFeature(feature, dx, dy) : feature,
        );

        const blocked = moved.find(
          (feature) =>
            selectedIds.includes(feature.id) && !featureIsLegal(feature, house, boundary),
        );
        if (blocked) {
          refusal = refusalFor(blocked);
          return null;
        }

        return { ...draft, features: moved };
      });

      if (refusal) set({ clash: refusal });
    },

    deleteFeature: (id) => {
      commit((draft) => {
        if (!draft.features.some((feature) => feature.id === id)) return null;
        return { ...draft, features: draft.features.filter((feature) => feature.id !== id) };
      });

      set((state) => ({
        selectedIds: state.selectedIds.filter((candidate) => candidate !== id),
        editingShapeId: state.editingShapeId === id ? null : state.editingShapeId,
      }));
    },

    deleteSelection: () => {
      const { selectedIds } = get();
      if (selectedIds.length === 0) return;

      commit((draft) => ({
        ...draft,
        features: draft.features.filter((feature) => !selectedIds.includes(feature.id)),
      }));

      set({ selectedIds: [], editingShapeId: null });
    },

    setStatus: (id, status) =>
      commit((draft) => {
        const feature = draft.features.find((candidate) => candidate.id === id);
        if (!feature || feature.status === status) return null;

        return {
          ...draft,
          features: draft.features.map((candidate) =>
            candidate.id === id ? withStatus(candidate, status) : candidate,
          ),
        };
      }),

    setSelectionStatus: (status) => {
      const { selectedIds } = get();
      if (selectedIds.length === 0) return;

      commit((draft) => {
        if (
          draft.features.every(
            (feature) => !selectedIds.includes(feature.id) || feature.status === status,
          )
        ) {
          return null;
        }

        return {
          ...draft,
          features: draft.features.map((feature) =>
            selectedIds.includes(feature.id) ? withStatus(feature, status) : feature,
          ),
        };
      });
    },

    setReplaceWith: (id, text) =>
      commit((draft) => {
        const feature = draft.features.find((candidate) => candidate.id === id);
        if (!feature || feature.status !== 'replace') return null;

        const replaceWith = text.trim() === '' ? null : text;
        if (replaceWith === feature.replaceWith) return null;

        return {
          ...draft,
          features: draft.features.map((candidate) =>
            candidate.id === id ? { ...candidate, replaceWith } : candidate,
          ),
        };
      }),

    renameFeature: (id, name) =>
      commit((draft) => {
        const trimmed = name.trim();
        const feature = draft.features.find((candidate) => candidate.id === id);
        if (!feature || trimmed === '' || trimmed === feature.name) return null;

        return {
          ...draft,
          features: draft.features.map((candidate) =>
            candidate.id === id ? { ...candidate, name: trimmed } : candidate,
          ),
        };
      }),

    /* ------------------------------------------------------------ shape editing */

    setEditingShape: (editingShapeId) =>
      set((state) => ({
        editingShapeId,
        // Editing a shape means that shape is what is selected, not whatever else was.
        selectedIds: editingShapeId ? [editingShapeId] : state.selectedIds,
        clash: null,
      })),

    moveVertexLive: (id, index, raw) => {
      const point = snapped(raw);

      applyLive(id, (feature) => {
        const points = featureVertices(feature);
        if (!points || !points[index]) return feature;

        return withVertices(
          feature,
          points.map((existing, at) => (at === index ? point : existing)),
        );
      });
    },

    insertVertex: (id, edgeIndex, raw) => {
      const point = snapped(raw);

      commitFeature(id, (feature) => {
        const points = featureVertices(feature);
        if (!points) return feature;

        const next = [...points];
        next.splice(edgeIndex + 1, 0, point);
        return withVertices(feature, next);
      });
    },

    deleteVertex: (id, index) =>
      commitFeature(id, (feature) => {
        const points = featureVertices(feature);
        // A triangle cannot lose a corner and a two-point line cannot lose an end.
        if (!points || points.length <= minimumVertices(feature)) return feature;

        return withVertices(
          feature,
          points.filter((_, at) => at !== index),
        );
      }),

    resizeFeatureLive: (id, size) => applyLive(id, (feature) => resizeFeature(feature, size)),
    rotateFeatureLive: (id, degrees) => applyLive(id, (feature) => rotateFeature(feature, degrees)),
    setCornerRadius: (id, radius) =>
      commitFeature(id, (feature) => applyCornerRadius(feature, radius)),

    /* ------------------------------------------------------------ selection */

    select: (id, options) =>
      set((state) => {
        if (id === null) return { selectedIds: [], editingShapeId: null, clash: null };

        if (options?.additive) {
          const already = state.selectedIds.includes(id);
          return {
            selectedIds: already
              ? state.selectedIds.filter((candidate) => candidate !== id)
              : [...state.selectedIds, id],
            editingShapeId: null,
            clash: null,
          };
        }

        return {
          selectedIds: [id],
          // Selecting something else leaves whatever was being reshaped.
          editingShapeId: state.editingShapeId === id ? state.editingShapeId : null,
          clash: null,
        };
      }),

    selectMany: (selectedIds) => set({ selectedIds, editingShapeId: null, clash: null }),

    beginMarquee: (at) => set({ marquee: { start: at, current: at } }),

    trackMarquee: (at) =>
      set((state) => (state.marquee ? { marquee: { ...state.marquee, current: at } } : state)),

    commitMarquee: () => {
      const { marquee, present } = get();
      if (!marquee) return;

      const box = {
        minX: Math.min(marquee.start.x, marquee.current.x),
        maxX: Math.max(marquee.start.x, marquee.current.x),
        minY: Math.min(marquee.start.y, marquee.current.y),
        maxY: Math.max(marquee.start.y, marquee.current.y),
      };

      // Partial overlap counts, so grazing a big patio picks it up rather than demanding the
      // marquee swallow it whole.
      const hits = present.features.filter((feature) => {
        const bounds = featureBounds(feature);
        return (
          bounds.minX <= box.maxX &&
          bounds.minX + bounds.width >= box.minX &&
          bounds.minY <= box.maxY &&
          bounds.minY + bounds.length >= box.minY
        );
      });

      /*
       * The box is only reachable with Shift held, and Shift already means "extend the
       * selection" on a click — so a sweep adds to what was picked rather than replacing it.
       */
      set((state) => ({
        marquee: null,
        selectedIds: [
          ...state.selectedIds,
          ...hits.map((feature) => feature.id).filter((id) => !state.selectedIds.includes(id)),
        ],
        editingShapeId: null,
      }));
    },

    /*
     * A drag fires dozens of move events. Snapshotting on drag start and only folding that
     * snapshot into history on drag end keeps one undo entry per gesture — and none at all if
     * the feature ends up back where it started.
     */
    beginGesture: () => set((state) => ({ gestureSnapshot: state.present })),

    endGesture: () =>
      set((state) => {
        const snapshot = state.gestureSnapshot;
        // The guides only mean anything mid-gesture.
        if (!snapshot) return { gestureSnapshot: null, alignments: [] };
        if (sameFeatures(snapshot, state.present)) return { gestureSnapshot: null, alignments: [] };

        return {
          gestureSnapshot: null,
          alignments: [],
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
          selectedIds: [],
          editingShapeId: null,
          clash: null,
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
          selectedIds: [],
          editingShapeId: null,
          clash: null,
        };
      }),

    resetFeatures: () =>
      set((state) => ({
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: initialDraft(),
        future: [],
        mode: 'select',
        placingKind: null,
        draftPoints: [],
        selectedIds: [],
        editingShapeId: null,
        marquee: null,
        alignments: [],
        measurement: null,
        clash: null,
        skipped: false,
        lastSavedAt: Date.now(),
      })),

    toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled, alignments: [] })),

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
      set({
        mode,
        placingKind: null,
        draftPoints: [],
        // Leaving measure mode throws the tape away — it was never meant to persist.
        measurement: null,
        clash: null,
      }),

    setSkipped: (skipped) => set({ skipped }),
  };
});

/** A replacement note only means anything while the answer is "replace". */
function withStatus(feature: PlacedFeature, status: FeatureStatus): PlacedFeature {
  return {
    ...feature,
    status,
    replaceWith: status === 'replace' ? feature.replaceWith : null,
  };
}

/** Whether two drafts describe the same garden — the test a drag uses to earn a history entry. */
function sameFeatures(a: FeaturesDraft, b: FeaturesDraft): boolean {
  if (a.features.length !== b.features.length) return false;

  return a.features.every((feature, index) => {
    const other = b.features[index];
    return (
      feature.id === other.id &&
      feature.status === other.status &&
      feature.name === other.name &&
      feature.replaceWith === other.replaceWith &&
      JSON.stringify(feature.geometry) === JSON.stringify(other.geometry)
    );
  });
}

/** Live counts for the summary line, and the shape the panels read a selection through. */
export function selectedFeatures(state: {
  present: FeaturesDraft;
  selectedIds: string[];
}): PlacedFeature[] {
  return state.present.features.filter((feature) => state.selectedIds.includes(feature.id));
}

/** Everything outside the stored section: the palette, the selection, the in-progress draw. */
function ephemeralState() {
  return {
    past: [] as FeaturesDraft[],
    future: [] as FeaturesDraft[],
    mode: 'select' as FeaturesMode,
    placingKind: null as FeatureKind | null,
    draftPoints: [] as Point[],
    selectedIds: [] as string[],
    editingShapeId: null as string | null,
    marquee: null,
    alignments: [] as AlignmentGuide[],
    snapEnabled: true,
    measurement: null,
    clash: null as string | null,
    gestureSnapshot: null as FeaturesDraft | null,
  };
}

/** Test hook: the store is a module singleton, so suites must reset it between cases. */
export function resetFeaturesStoreForTests(): void {
  featureCounter = 0;

  useFeaturesStore.setState({
    ...ephemeralState(),
    present: initialDraft(),
    skipped: false,
    lastSavedAt: Date.now(),
  });
}

/**
 * Loads the stored features into the editor.
 *
 * Note `skipped` is restored alongside `present`. It lives outside the history stack but it is
 * real user intent — an empty list because the garden is bare reads differently from an empty
 * list because nobody has started — so it is part of the document and has to come back.
 */
export function hydrateFeaturesStore(section: FeaturesSection, savedAt: number): void {
  featureCounter = highestId(
    section.features.map((feature) => feature.id),
    /^f(\d+)$/,
  );

  useFeaturesStore.setState({
    ...ephemeralState(),
    present: { features: section.features },
    skipped: section.skipped,
    lastSavedAt: savedAt,
  });
}

export { housePolygonNow };
