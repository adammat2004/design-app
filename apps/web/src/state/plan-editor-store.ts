'use client';

import { create } from 'zustand';
import {
  FENCE_REFUSAL,
  LOCKED_REFUSAL,
  SYMBOLS,
  PLANT_CATALOGUE,
  associatePlants,
  isPlantSymbol,
  type SymbolId,
} from '@garden-studio/schema';
import type { Maturity } from '@/lib/render/scene';
import type { DesignEvent, LayoutSection, Point, ProposedChange } from '@garden-studio/schema';
import { draftPolygon, polygonCentroid } from '@/lib/boundary-geometry';
import { highestId } from '@/lib/hydration';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import {
  elementAnchor,
  isLocked,
  type DesignElement,
  type ElementCategory,
  type GeneratedConcept,
} from '@/lib/concepts';
import {
  geometryIsLegal,
  geometryOutline,
  translateFeature,
  type PlanGeometry,
} from '@/lib/features';
import { snapPoint } from '@/lib/grid';
import {
  alignmentGuidesFor,
  boxSnapLines,
  collectSnapTargets,
  cornerSnapLines,
  type AlignmentGuide,
  type SnapTargets,
} from '@/lib/guides';
import { housePolygon } from '@/lib/house';
import { defaultMaterial } from '@/lib/materials';
import { zoneAt, type ZoneId } from '@/lib/zones';
import { selectZones, useBoundaryStore } from './boundary-store';
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
export const NUDGE = 0.1;

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
const LOCKED_CLASH = LOCKED_REFUSAL;

export type PlanEditorMode = 'select' | 'pan' | 'measure';

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

interface PlanEditorState {
  past: PlanEditorDraft[];
  present: PlanEditorDraft;
  future: PlanEditorDraft[];

  /** Concept id this layout came from. A change to the chosen concept re-seeds. */
  seededFrom: string | null;
  /** The concept exactly as generated, so Reset has something true to go back to. */
  pristine: DesignElement[] | null;

  /*
   * Ephemeral. Outside history for the reason step 2 keeps its tools out: Undo should rewind the
   * garden, not which tool was last pressed.
   */
  mode: PlanEditorMode;
  selectedId: string | null;
  placingCategory: ElementCategory | null;
  /** With `placingCategory`: the thing being placed, when it is a piece of furniture. */
  placingSymbol: SymbolId | null;
  placingPlantId: string | null;
  snapEnabled: boolean;
  /** Graph paper on or off. A view preference, so it never enters the undo history. */
  gridVisible: boolean;
  /**
   * How grown-in Visualise draws the planting.
   *
   * A view preference beside `gridVisible`, and deliberately **not** on the document. It changes
   * how the picture is drawn and nothing about the design: no geometry moves, no area changes, no
   * quantity is affected, and the schedule on step 6 cannot see it. Nothing that can disagree with
   * the plan it summarises is worth persisting — the same argument the review screen makes for
   * storing nothing.
   *
   * It lives here rather than in the panel so that Visualise and the PNG export agree about which
   * garden they are drawing.
   */
  maturity: Maturity;
  previewMinutes: number | null;
  /**
   * Whether the plan is annotated.
   *
   * A viewing preference, not a design decision, so it sits in `ephemeralState` beside
   * `gridVisible` rather than on the document — the same reasoning that keeps the grid out of the
   * saved plan. Labels are on by default because a plan you cannot read is a picture.
   */
  labelsVisible: boolean;
  /**
   * Zone tints and dimension guides, both view preferences beside `gridVisible`.
   *
   * Zones are **off** by default on this screen and that is deliberate rather than an oversight:
   * they are scaffolding for "which parts do you want designed", and once that is answered writing
   * "Back garden ≈ 18 m²" across a finished design is a note about the tool rather than about the
   * garden. The toggle exists because a user checking their own answer should be able to see them
   * again — which they could not before, on any screen.
   *
   * Dimensions are **on**: a plan without them is a picture.
   */
  zonesVisible: boolean;
  dimensionsVisible: boolean;
  alignments: AlignmentGuide[];
  measurement: { from: Point; to: Point | null } | null;
  clash: string | null;
  gestureSnapshot: PlanEditorDraft | null;
  lastSavedAt: number;

  seedFrom: (concept: GeneratedConcept) => void;
  select: (id: string | null) => void;

  addElement: (category: ElementCategory, at: Point) => void;
  moveElementLive: (id: string, anchor: Point) => void;
  setPosition: (id: string, anchor: Point) => void;
  setCanopyDiameter: (id: string, metres: number) => void;
  replaceSymbol: (id: string, symbol: SymbolId, plantId?: string) => void;
  setStatus: (id: string, status: DesignElement['status']) => void;
  resizeElementLive: (id: string, size: Partial<{ width: number; depth: number }>) => void;
  rotateElementLive: (id: string, degrees: number) => void;
  nudgeSelection: (dx: number, dy: number) => void;

  renameElement: (id: string, name: string) => void;
  setMaterial: (id: string, materialId: string) => void;
  /** `''` clears it back to the spade cut every border has for free. */
  setEdging: (id: string, materialId: string) => void;
  /** `''` clears it back to a plain upstand in the element's own paving. */
  setRetaining: (id: string, materialId: string) => void;
  setZone: (id: string, zone: ZoneId) => void;
  setElevation: (id: string, metres: number) => void;
  toggleHidden: (id: string) => void;
  duplicateElement: (id: string) => void;
  deleteElement: (id: string) => void;

  beginGesture: () => void;
  /** `silent` suppresses the design event, for a caller that reports its own. */
  endGesture: (options?: { silent?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  resetToConcept: () => void;

  toggleSnap: () => void;
  toggleGrid: () => void;
  setMaturity: (maturity: Maturity) => void;
  setPreviewMinutes: (minutes: number | null) => void;
  toggleLabels: () => void;
  toggleZones: () => void;
  toggleDimensions: () => void;
  /** Metres tall. Read by the shadow model, and until now invisible to the user who owns it. */
  setHeight: (id: string, metres: number) => void;
  setMode: (mode: PlanEditorMode) => void;
  setPlacing: (
    category: ElementCategory | null,
    symbol?: SymbolId | null,
    plantId?: string | null,
  ) => void;
  addMeasurePoint: (point: Point) => void;
  trackMeasurePointer: (point: Point) => void;
  clearMeasurement: () => void;
  clearClash: () => void;

  /** Applies the accepted lines of one proposal as a single history entry. */
  applyProposal: (changes: ProposedChange[], acceptedIds: string[]) => ApplyOutcome;
}

/* ---------------------------------------------------------------- the property, read live */

function housePolygonNow(): Point[] | null {
  const house = useBoundaryStore.getState().present.house;
  return house ? housePolygon(house) : null;
}

function boundaryNow(): Point[] {
  return draftPolygon(useBoundaryStore.getState().present);
}

/** Why an edit was refused, or null if it is fine. Step 2's rule, verbatim. */
function refusalFor(geometry: PlanGeometry): string | null {
  return geometryIsLegal(geometry, boundaryNow()) ? null : FENCE_CLASH;
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
        refusal = LOCKED_CLASH;
        return null;
      }

      const next = mutate(element);
      if (next === element) return null;

      if (checkGeometry) {
        // A resize or a move has no meaningful partial version, so an impossible one is refused
        // rather than half-applied — the same call step 2's features make.
        refusal = refusalFor(next.shape);
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
      if (isLocked(element)) return { clash: LOCKED_CLASH };

      const next = mutate(element);
      if (next === element) return state;

      const refusal = refusalFor(next.shape);
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

  function snapped(point: Point): Point {
    if (!get().snapEnabled) return point;
    return snapPoint(point, useBoundaryStore.getState().unit);
  }

  /** Everything a dragged element can line up with, minus the one being dragged. */
  function snapTargetsExcluding(id: string): SnapTargets {
    const house = housePolygonNow();
    const sources: SnapTargets[] = [cornerSnapLines(boundaryNow())];

    if (house) sources.push(boxSnapLines(house));

    for (const element of get().present.elements) {
      // Base fills are the whole zone, so their edges are the zone's edges — useful to align to.
      if (element.id === id || element.hidden) continue;
      sources.push(boxSnapLines(geometryOutline(element.shape)));
    }

    return collectSnapTargets(sources);
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

    mode: 'select',
    selectedId: null,
    placingCategory: null,
    placingSymbol: null,
    placingPlantId: null,
    snapEnabled: true,
    gridVisible: false,
    maturity: 'mature',
    previewMinutes: null,
    labelsVisible: false,
    zonesVisible: false,
    dimensionsVisible: false,
    alignments: [],
    measurement: null,
    clash: null,
    gestureSnapshot: null,
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
        selectedId: null,
        placingCategory: null,
        placingSymbol: null,
        placingPlantId: null,
        alignments: [],
        measurement: null,
        clash: null,
        gestureSnapshot: null,
        lastSavedAt: Date.now(),
      });
    },

    select: (id) => set({ selectedId: id, clash: null }),

    addElement: (category, at) => {
      const centre = snapped(at);
      const symbol = get().placingSymbol;
      const plantId = get().placingPlantId;
      const plant = plantId ? PLANT_CATALOGUE[plantId] : undefined;

      /*
       * A symbol brings its own footprint — a lounger is 0.7 × 1.9 m whatever category it is —
       * and a round one is placed as a point, the way the generator places a fire pit bowl.
       */
      const footprint = symbol ? SYMBOLS[symbol].footprint : null;
      const size = footprint?.kind === 'rect' ? footprint : NEW_ELEMENT_SIZE[category];
      const shape: PlanGeometry =
        footprint?.kind === 'point'
          ? { kind: 'point', at: centre, radius: plant ? plant.spread / 2 : footprint.radius }
          : { kind: 'rect', centre, width: size.width, depth: size.depth, rotation: 0 };

      const refusal = refusalFor(shape);
      if (refusal) {
        set({ clash: refusal });
        return;
      }

      const id = nextElementId();
      const zones = selectZones({ present: useBoundaryStore.getState().present });

      commit((draft) => ({
        ...draft,
        elements: [
          ...draft.elements,
          {
            id,
            category,
            role: 'feature',
            name:
              plant?.name ??
              (symbol ? SYMBOLS[symbol].label : defaultName(category, draft.elements)),
            shape,
            zone: zoneAt(centre, zones)?.id ?? 'back',
            material: defaultMaterial(category),
            elevation: 0,
            ...(symbol ? { symbol, height: plant?.height ?? SYMBOLS[symbol].height } : {}),
            ...(plantId ? { plantId } : {}),
          },
        ],
      }));

      set({ selectedId: id, placingCategory: null, placingSymbol: null, placingPlantId: null });
      /* Something the generator did not think of. See `state/design-events.ts`. */
      emitDesignEvent('element_added', { elementId: id, category });
    },

    moveElementLive: (id, anchor) => {
      const element = get().present.elements.find((candidate) => candidate.id === id);
      if (!element || isLocked(element)) return;

      const target = snapped(anchor);
      const moved = translateTo(element, target);

      // Nudge onto any alignment the shape has come close to, then report the guides so the
      // canvas can draw them.
      const outline = geometryOutline(moved.shape);
      const targets = snapTargetsExcluding(id);
      const guides = get().snapEnabled ? alignmentGuidesFor(outline, targets) : [];

      set({ alignments: guides });
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
        return {
          ...element,
          symbol,
          plantId,
          name: plant?.name ?? spec.label,
          height: element.height ?? plant?.height ?? spec.height,
        };
      });
    },

    setStatus: (id, status) =>
      commitElement(id, (element) => ({ ...element, status }), { checkGeometry: false }),

    resizeElementLive: (id, size) =>
      applyLive(id, (element) => {
        if (element.shape.kind !== 'rect') return element;

        return {
          ...element,
          shape: {
            ...element.shape,
            width: Math.max(MIN_ELEMENT_SIDE, size.width ?? element.shape.width),
            depth: Math.max(MIN_ELEMENT_SIDE, size.depth ?? element.shape.depth),
          },
        };
      }),

    rotateElementLive: (id, degrees) =>
      applyLive(id, (element) => {
        if (element.shape.kind !== 'rect') return element;
        const normalised = ((degrees % 360) + 360) % 360;

        return { ...element, shape: { ...element.shape, rotation: normalised } };
      }),

    nudgeSelection: (dx, dy) => {
      const { selectedId } = get();
      if (!selectedId) return;

      const element = get().present.elements.find((candidate) => candidate.id === selectedId);
      if (!element) return;

      const at = elementAnchor(element);
      applyLive(selectedId, () => translateTo(element, { x: at.x + dx, y: at.y + dy }));
    },

    renameElement: (id, name) =>
      commitElement(id, (element) => ({ ...element, name: name.trim() || element.name }), {
        checkGeometry: false,
      }),

    // Material is the one edit a locked base fill accepts — turning the lawn to gravel is a real
    // decision, and it cannot open a gap in the ground.
    setMaterial: (id, materialId) =>
      commitElement(id, (element) => ({ ...element, material: materialId }), {
        checkGeometry: false,
      }),

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

    duplicateElement: (id) => {
      const element = get().present.elements.find((candidate) => candidate.id === id);
      if (!element || isLocked(element)) {
        if (element) set({ clash: LOCKED_CLASH });
        return;
      }

      // Offset by a metre so the copy is visible rather than exactly behind the original.
      const at = elementAnchor(element);
      const copy: DesignElement = {
        ...translateTo(element, { x: at.x + 1, y: at.y + 1 }),
        id: nextElementId(),
        name: defaultName(element.category, get().present.elements),
      };

      const refusal = refusalFor(copy.shape);
      if (refusal) {
        set({ clash: refusal });
        return;
      }

      commit((draft) => ({ ...draft, elements: [...draft.elements, copy] }));
      set({ selectedId: copy.id });
    },

    deleteElement: (id) => {
      const element = get().present.elements.find((candidate) => candidate.id === id);
      if (!element) return;

      if (isLocked(element)) {
        set({ clash: LOCKED_CLASH });
        return;
      }

      commit((draft) => ({
        ...draft,
        elements: draft.elements.filter((candidate) => candidate.id !== id),
      }));
      set((state) => ({ selectedId: state.selectedId === id ? null : state.selectedId }));
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
    beginGesture: () => set((state) => ({ gestureSnapshot: state.present })),

    endGesture: (options = {}) =>
      set((state) => {
        const snapshot = state.gestureSnapshot;
        // The guides only mean anything mid-gesture.
        if (!snapshot) return { gestureSnapshot: null, alignments: [] };
        if (sameElements(snapshot, state.present)) return { gestureSnapshot: null, alignments: [] };

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
          future: [state.present, ...state.future].slice(0, HISTORY_LIMIT),
          clash: null,
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
          selectedId: null,
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

    setMaturity: (maturity) => set({ maturity }),
    setPreviewMinutes: (minutes) => set({ previewMinutes: minutes === null ? null : Math.max(0, Math.min(1425, minutes)) }),

    toggleLabels: () => set((state) => ({ labelsVisible: !state.labelsVisible })),

    toggleZones: () => set((state) => ({ zonesVisible: !state.zonesVisible })),

    toggleDimensions: () => set((state) => ({ dimensionsVisible: !state.dimensionsVisible })),

    setMode: (mode) =>
      set({
        mode,
        placingCategory: null,
        placingSymbol: null,
        placingPlantId: null,
        measurement: null,
        clash: null,
      }),

    setPlacing: (category, symbol = null, plantId = null) =>
      set({
        placingCategory: category,
        placingSymbol: symbol,
        placingPlantId: plantId,
        mode: 'select',
        clash: null,
      }),

    addMeasurePoint: (point) =>
      set((state) => {
        if (!state.measurement || state.measurement.to)
          return { measurement: { from: point, to: null } };
        return { measurement: { ...state.measurement, to: point } };
      }),

    trackMeasurePointer: (point) =>
      set((state) =>
        state.measurement && !state.measurement.to
          ? { measurement: { ...state.measurement, to: point } }
          : state,
      ),

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
    applyProposal: (changes, acceptedIds) => {
      const outcome: ApplyOutcome = { applied: [], refused: [] };
      const accepted = changes.filter((change) => acceptedIds.includes(change.id));
      if (accepted.length === 0) return outcome;

      const boundary = boundaryNow();

      get().beginGesture();

      for (const change of accepted) {
        const draft = get().present;

        if (change.kind === 'add') {
          if (!geometryIsLegal(change.next.shape, boundary)) {
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
            outcome.refused.push({ changeId: change.id, reason: LOCKED_CLASH });
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

        const movesGeometry = change.kind !== 'material';

        if (movesGeometry && isLocked(existing)) {
          outcome.refused.push({ changeId: change.id, reason: LOCKED_CLASH });
          continue;
        }

        if (movesGeometry && !geometryIsLegal(change.next.shape, boundary)) {
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

      get().endGesture();
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
      JSON.stringify(element.shape) === JSON.stringify(other.shape)
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
    placingCategory: null as ElementCategory | null,
    placingSymbol: null as SymbolId | null,
    placingPlantId: null as string | null,
    snapEnabled: true,
    gridVisible: false,
    maturity: 'mature' as Maturity,
    previewMinutes: null,
    labelsVisible: false,
    zonesVisible: false,
    dimensionsVisible: false,
    alignments: [] as AlignmentGuide[],
    measurement: null,
    clash: null as string | null,
    gestureSnapshot: null as PlanEditorDraft | null,
  };
}

export function resetPlanEditorStoreForTests(): void {
  elementCounter = 0;

  usePlanEditorStore.setState({
    ...ephemeralState(),
    present: emptyDraft(),
    seededFrom: null,
    pristine: null,
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
    lastSavedAt: savedAt,
  });
}
