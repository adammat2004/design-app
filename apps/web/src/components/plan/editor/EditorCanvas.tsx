'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Stage } from 'react-konva';
import type Konva from 'konva';
import { CircleAlert, Trash2 } from 'lucide-react';
import {
  effectiveBoundaryRuns,
  ENCLOSURE_KINDS,
  computeZones,
  clearances,
  cornersOf,
  cutEdgeMasksFor,
  elementMeasures,
  geometryVertices,
  isGroundLayer,
  edgePlanOf,
  freeSpanAt,
  lightDirection,
  resolveEdges,
  sampleChain,
  sideChains,
  spanOfRun,
  SYMBOLS,
  treatmentSpec,
  type Point,
} from '@garden-studio/schema';
import { EdgeEditLayer } from './EdgeEditLayer';
import { VertexEditor } from './VertexEditor';
import { DraftOverlay } from './DraftOverlay';
import { DrawToolStrip } from './DrawToolStrip';
import { DRAG_THRESHOLD_PX } from '../use-canvas-viewport';
import { useEdgeRules } from '@/lib/edge-rules';
import { draftPolygon, edgeLength, midpoint } from '@/lib/boundary-geometry';
import { COLOUR } from '@/lib/canvas-colours';
import {
  metresToPx,
  polygonToKonvaPoints,
  pxToMetres,
  type CanvasTransform,
} from '@/lib/canvas-transform';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import { pathDimensionGuides, plotDimensionGuides, type DimensionGuide } from '@/lib/guides';
import {
  describeElement,
  elementAnchor,
  elementOutline,
  isLocked,
  type DesignElement,
} from '@/lib/concepts';
import { housePolygon, houseSize } from '@/lib/house';
import { editorShortcut, shortcutTarget } from '@/lib/editor-shortcuts';
import { isShown } from '@/lib/view-groups';
import { formatLength, type Unit } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import {
  MIN_ELEMENT_SIDE,
  selectedElement,
  usePlanEditorStore,
} from '@/state/plan-editor-store';
import { CanvasChrome } from '../CanvasChrome';
import { GateMarks, gateGaps } from '../GateMarks';
import { HouseOpenings } from '../HouseOpenings';
import { HouseShape } from '../HouseShape';
import { ShapeHandles } from '../ShapeHandles';
import { scenePasses, exclusionMap, type ElementPass } from '@/lib/materials/scene-passes';
import { ElementDrawing } from '../ElementDrawing';
import { ShadowLayer } from '../ShadowLayer';
import {
  AlignmentLines,
  FenceLine,
  Label,
  MeasurementGuides,
  SquareGrid,
} from '../canvas-primitives';
import { useCanvasViewport } from '../use-canvas-viewport';
import { ConceptLabels } from '../concepts/ConceptLabels';
import { AiOverlayGroup } from './AiOverlayGroup';
import { MotionGroup } from './MotionGroup';
import type { MotionEntry } from '@/lib/ai-run/evaluate';
import { selectRunActive, useAiRunStore } from '@/state/ai-run-store';
import { EditorScene } from './EditorScene';
import { buildRenderScene } from '@/lib/render/build-scene';
import { browserRendererVersion } from '@/lib/render/diagnostics';
import { isStageDrag } from '../use-canvas-viewport';

/**
 * Step 5's plan, and the one canvas in the wizard where a generated layout can be changed.
 *
 * Step 4's `ConceptCanvas` draws the same thing and is deliberately inert — that screen is for
 * choosing between concepts, not editing one. Rather than add an `interactive` flag there and
 * make one component answer to two screens, this is its own file: the drawing is a handful of
 * shared primitives, and everything that differs is interaction.
 *
 * Element rendering follows the same rule as step 4 — array order is stacking order, base fills
 * under accents under features — because that order is what guarantees no zone shows bare grid.
 */
/** Stable empties, so a canvas with no run in progress never re-memoises its element list. */
const EMPTY_SUPPRESS: string[] = [];
const EMPTY_MOTION: MotionEntry[] = [];
const EMPTY_ELEMENTS: DesignElement[] = [];

export function EditorCanvas() {
  const [richReady, setRichReady] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const boundaryDraft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);

  /*
   * What the AI is doing to this plan, if anything.
   *
   * Three things it changes here, and no more: which elements the settled renderer draws, whether
   * the user's own tools are live, and two extra layers on top. The plan itself is written by the
   * run through the ordinary store, so everything below this line goes on reading `present` exactly
   * as it did before the feature existed.
   */
  const aiFrame = useAiRunStore((state) => state.frame);
  const aiActive = useAiRunStore(selectRunActive);
  const comparing = useAiRunStore((state) => state.compare === 'before');
  const aiRevision = useAiRunStore((state) => state.revision);

  /*
   * Selected raw and filtered in a memo, not through a selector.
   *
   * Zustand v5 reads through `useSyncExternalStore`, which compares snapshots by identity. A
   * selector that builds a fresh array every call — anything ending in `.filter(...)` — never
   * settles, and the render loop takes the tab down with it. Only reference-stable reads may go
   * inside the hook.
   */
  const storedElements = usePlanEditorStore((state) => state.present.elements);

  /*
   * Comparing swaps what is drawn and touches nothing else — not `present`, not the history. The
   * one place in the app where the canvas draws something other than the live plan, and it is
   * temporary, obvious on screen, and reversible by pressing the same button again.
   */
  const allElements = comparing && aiRevision ? aiRevision.initial : storedElements;

  /*
   * What the real renderer draws while the AI is working.
   *
   * An element being moved is **substituted**, not hidden: the renderer is handed the same element
   * with this instant's geometry, so a terrace being enlarged goes on being drawn in its own paving.
   * Drawing it flat on a layer above instead was tried and is visibly wrong — the plan is
   * photographic, and a grey rectangle sliding across it reads as the renderer having broken rather
   * than as a terrace being enlarged.
   *
   * Only what the scene genuinely cannot express is hidden and drawn over the top: something fading
   * out, and the old route while its replacement is drawn along. Both need a per-element opacity,
   * which a plan has nowhere to put and should not have.
   */
  const hiddenGroups = usePlanEditorStore((state) => state.hiddenGroups);
  const motion = aiFrame?.motion ?? EMPTY_MOTION;
  const suppressed = aiFrame?.suppress ?? EMPTY_SUPPRESS;
  const elements = useMemo(() => {
    const substitutes = new Map(
      motion.filter((entry) => entry.replacesSettled).map((entry) => [entry.element.id, entry.element]),
    );
    return allElements
      .filter((element) => isShown(element, hiddenGroups) && !suppressed.includes(element.id))
      .map((element) => substitutes.get(element.id) ?? element);
  }, [allElements, motion, suppressed, hiddenGroups]);
  /* The survey's sides as the design leaves them, and the fences and walls it proposes. */
  const effectiveBoundary = effectiveBoundaryRuns(boundaryDraft, elements);

  /** Only the entries the scene could not draw for itself. */
  const overlaidMotion = useMemo(
    () => motion.filter((entry) => !entry.replacesSettled),
    [motion],
  );
  /*
   * "Rich" here means the photographic renderer — Pixi drawing the same ground rasters the
   * composer paints — built from the same options the PNG export passes, so the download and the
   * screen draw one garden.
   */
  const shadowsVisible = usePlanEditorStore((state) => state.shadowsVisible);
  const edgeRules = useEdgeRules();
  const richScene = useMemo(() => buildRenderScene({ boundary: draftPolygon(boundaryDraft),
    house: boundaryDraft.house, site: boundaryDraft, elements, edgeRules },
    { shadows: shadowsVisible, rendererVersion: browserRendererVersion() }),
  [boundaryDraft, elements, shadowsVisible, edgeRules]);

  /*
   * One sun for the whole drawing. `undefined` means the plan has never said where it is, and
   * everything falls back to the conventional top-left drawing light — bevels, blob highlights
   * and cast shadows together, rather than some of each.
   */
  const light = useMemo(() => lightDirection(boundaryDraft) ?? undefined, [boundaryDraft]);

  /*
   * Where the shadow layer is spliced in: after every fill, before every feature.
   *
   * Found rather than assumed. `-1` means the plan is all ground and no objects, in which case
   * the shadows go last and nothing is drawn over them — which is correct, not a fallback.
   */
  const passes = useMemo(() => scenePasses(elements), [elements]);
  const gestureSnapshot = usePlanEditorStore((state) => state.gestureSnapshot);
  const settledElements = gestureSnapshot?.elements ?? elements;
  // Hold neighbouring beds and global shadows still during a gesture; refresh on release.
  const exclusions = useMemo(() => exclusionMap(settledElements), [settledElements]);
  /*
   * Which sides of each surface carry the cut edge, decided from the settled plan for the same
   * reason the exclusions are: a bed dragged across its neighbours must not repaint them per frame.
   */
  const edgeContext = useMemo(
    () => ({
      boundary: draftPolygon(boundaryDraft),
      house: boundaryDraft.house ? housePolygon(boundaryDraft.house) : undefined,
    }),
    [boundaryDraft],
  );
  const cutEdges = useMemo(
    () => cutEdgeMasksFor(settledElements, resolveEdges(settledElements, edgeContext, edgeRules)),
    [settledElements, edgeContext, edgeRules],
  );

  /*
   * While the AI has the plan its overlay draws the selection, so the editor's own must not.
   *
   * The run *does* set `selectedId` — that is how the properties panel follows the work, and it is
   * the honest thing for the store to hold. What would be wrong is drawing it twice: the editor's
   * green outline, its grab handles and its size badge on top of the AI's own outline and handles,
   * two of everything in two colours over one shape.
   */
  const storedSelection = usePlanEditorStore(selectedElement);
  const selected = aiActive || comparing ? null : storedSelection;
  const selectedIds = usePlanEditorStore((state) => state.selectedIds);
  /* Handles and a size badge describe one thing; with several selected there is no one to describe. */
  const single = selectedIds.length <= 1;
  const gesturingNow = usePlanEditorStore((state) => state.gestureSnapshot !== null);
  const marquee = usePlanEditorStore((state) => state.marquee);
  /*
   * The selected surface's boundary, open for editing — the Edges tab in the inspector is what opens
   * it, and `edgeEdit` names the host. Resolved against the live plan rather than the settled one,
   * because a handle drag *is* the gesture and has to see its own frames.
   */
  const edgeEdit = usePlanEditorStore((state) => state.edgeEdit);
  const vertexEdit = usePlanEditorStore((state) => state.vertexEdit);
  /* The polygon or path whose corners are open — only while it is the selection and not the AI's. */
  const vertexHost =
    selected && vertexEdit?.id === selected.id && geometryVertices(selected.shape) ? selected : null;
  const [hoveredVertexEdge, setHoveredVertexEdge] = useState<number | null>(null);
  const edgeHost = selected && edgeEdit?.hostId === selected.id ? selected : null;
  const edgeView = useMemo(() => {
    if (!edgeHost) return null;
    const resolution = resolveEdges(elements, edgeContext, edgeRules);
    return {
      resolution,
      chains: resolution.graph.chainsOf(edgeHost.id),
      runs: resolution.runs.filter((run) => run.hostId === edgeHost.id),
      editable: edgePlanOf(edgeHost).mode === 'custom',
    };
  }, [edgeHost, elements, edgeContext, edgeRules]);
  const [bareHover, setBareHover] = useState<{ side: number; from: number; to: number } | null>(null);
  const selectedEdgeRun =
    edgeView && edgeEdit?.selectedRunId
      ? (edgeView.runs.find((run) => run.runId === edgeEdit.selectedRunId) ?? null)
      : null;
  const mode = usePlanEditorStore((state) => state.mode);
  const gridVisible = usePlanEditorStore((state) => state.gridVisible);
  const labelsVisible = usePlanEditorStore((state) => state.labelsVisible);
  const zonesVisible = usePlanEditorStore((state) => state.zonesVisible);
  const dimensionsVisible = usePlanEditorStore((state) => state.dimensionsVisible);
  const placingCategory = usePlanEditorStore((state) => state.placingCategory);
  const placingSymbol = usePlanEditorStore((state) => state.placingSymbol);
  const placingEnclosure = usePlanEditorStore((state) => state.placingEnclosure);
  const placingTool = usePlanEditorStore((state) => state.placingTool);
  const draftPoints = usePlanEditorStore((state) => state.draftPoints);
  /* A plain surface is drawn with a tool; a symbol — a bench, a tree — is only ever placed. */
  const drawingSurface = placingCategory !== null && placingSymbol === null;
  const drawingCorners = drawingSurface && placingTool !== 'rect';
  const [rubberBand, setRubberBand] = useState<{ start: Point; current: Point } | null>(null);
  const [drawPointer, setDrawPointer] = useState<Point | null>(null);
  /* The click a finished rubber-band drag ends with, which must not also drop a default-size one. */
  const [swallowClick, setSwallowClick] = useState(false);
  /* What the last click while drawing did — a real double click's second click is a dropped repeat. */
  const lastDraftClick = useRef<'added' | 'closed' | 'ignored' | null>(null);
  const alignments = usePlanEditorStore((state) => state.alignments);
  const snapMarker = usePlanEditorStore((state) => state.snapMarker);
  const measurement = usePlanEditorStore((state) => state.measurement);
  const clash = usePlanEditorStore((state) => state.clash);

  const {
    wrapperRef,
    stageRef,
    size,
    transform,
    panning,
    panActive,
    setPanning,
    handleStageDragStart,
    handleStageDragEnd,
    consumePan,
    armPan,
    registerTap,
    isDoubleTap,
    handlePointerDown,
    handlePointerUp,
    detailed,
    canRender,
    stageCentre,
    fitToShape,
    zoomAbout,
    handleWheel,
    pointerInMetres,
  } = useCanvasViewport({
    getPolygon: () => draftPolygon(useBoundaryStore.getState().present),
    fitPaddingRatio: 0.04,
  });

  /*
   * The Move tool is the pan tool. Rather than give the toolbar its own panning implementation,
   * it drives the same `panning` flag the zoom stack's hand button does — so the two controls can
   * never disagree about whether the view is being dragged.
   */
  useEffect(() => {
    setPanning(mode === 'pan');
  }, [mode, setPanning]);

  const polygon = useMemo(() => draftPolygon(boundaryDraft), [boundaryDraft]);
  // Derived, never stored — the same rule everywhere zones appear.
  const zones = useMemo(
    () => (boundaryDraft.house ? computeZones(polygon, boundaryDraft.house) : []),
    [polygon, boundaryDraft.house],
  );

  const houseOutline = useMemo(
    () => (boundaryDraft.house ? housePolygon(boundaryDraft.house) : null),
    [boundaryDraft.house],
  );

  /* ---------------------------------------------------------------- interaction */

  function handleStageMouseDown(event: Konva.KonvaEventObject<MouseEvent>) {
    // The middle button pans on this canvas too, for the hand that never leaves the mouse.
    if (handlePointerDown(event)) return;

    const onEmpty = event.target === event.target.getStage();
    const store = usePlanEditorStore.getState();

    /*
     * Drawing claims the press, or the stage's always-on pan would take it: dragging out a rectangle
     * and clicking corners are both presses on empty canvas. Drawing corners, a quick second press
     * on the spot just clicked still pans — the same double-tap step 2 draws with.
     */
    if (onEmpty && drawingSurface && placingTool === 'rect' && event.evt.button === 0) {
      armPan(false);
      const at = pointerInMetres();
      if (at) {
        const start = store.previewDraftPoint(at, { pxPerMetre: transform.scale });
        setRubberBand({ start, current: start });
      }
      return;
    }
    if (onEmpty && drawingCorners) {
      armPan(isDoubleTap(event));
      return;
    }
    /*
     * Shift-drag sweeps a selection — step 2's marquee. It starts on bare canvas *or on the ground
     * layer*: every zone is covered by a base fill, so inside a garden there is no bare canvas, and a
     * marquee that needed some could never be started. A feature's own press never reaches here — it
     * claims it — so Shift-dragging a feature still moves the selection. A plain drag still pans.
     */
    if (!placingCategory && mode === 'select' && event.evt.shiftKey && event.evt.button === 0) {
      armPan(false);
      const at = pointerInMetres();
      if (at) store.beginMarquee(at);
      return;
    }
    armPan(true);
  }

  function handleStageMouseUp(event: Konva.KonvaEventObject<MouseEvent>) {
    handlePointerUp(event);
    const store = usePlanEditorStore.getState();
    if (store.marquee) {
      const { start, current } = store.marquee;
      const moved = Math.hypot(current.x - start.x, current.y - start.y) * transform.scale;
      /* A sweep selects; a Shift-click on bare canvas that barely moved does nothing at all. */
      if (moved >= DRAG_THRESHOLD_PX) store.commitMarquee();
      else usePlanEditorStore.setState({ marquee: null });
      setSwallowClick(true);
      return;
    }
    if (!rubberBand || !placingCategory) return;
    setRubberBand(null);

    const width = Math.abs(rubberBand.current.x - rubberBand.start.x);
    const depth = Math.abs(rubberBand.current.y - rubberBand.start.y);
    /* A press that barely moved is a click, and a click drops the default size, as it always did. */
    if (width * transform.scale < DRAG_THRESHOLD_PX || depth * transform.scale < DRAG_THRESHOLD_PX) return;

    setSwallowClick(true);
    usePlanEditorStore.getState().addElement(
      placingCategory,
      {
        x: (rubberBand.start.x + rubberBand.current.x) / 2,
        y: (rubberBand.start.y + rubberBand.current.y) / 2,
      },
      {
        keepArmed: event.evt.shiftKey,
        size: { width: Math.max(MIN_ELEMENT_SIDE, width), depth: Math.max(MIN_ELEMENT_SIDE, depth) },
      },
    );
  }

  function handleStageClick(event?: Konva.KonvaEventObject<MouseEvent>) {
    // A pan that ended over empty canvas must not also clear the selection.
    if (consumePan()) return;
    if (swallowClick) {
      setSwallowClick(false);
      return;
    }

    const at = pointerInMetres();
    const store = usePlanEditorStore.getState();

    if (mode === 'measure') {
      if (at) store.addMeasurePoint(at, { pxPerMetre: transform.scale });
      return;
    }

    /* Shift keeps the item armed, so a row of trees is a row of clicks. */
    const keepArmed = event?.evt?.shiftKey === true;
    if (drawingCorners && at) {
      if (event) registerTap(event);
      lastDraftClick.current = store.addDraftPoint(at, { pxPerMetre: transform.scale, keepArmed });
      return;
    }
    if (placingCategory && at) {
      store.addElement(placingCategory, at, { keepArmed });
      return;
    }

    store.select(null);
  }

  /*
   * A double click finishes a path or a shape, the way it finishes a line on step 2.
   *
   * Konva fires `dblclick` for *any* two clicks inside its time window, however far apart, and after
   * the second click's own handler — so two quick corners in a row finished the shape a corner early.
   * A real double click is two clicks on one spot, and its second is dropped as a repeat of the
   * corner the first added; that, and nothing else, is what finishes.
   */
  function handleStageDblClick(event: Konva.KonvaEventObject<MouseEvent>) {
    if (!drawingCorners || lastDraftClick.current !== 'ignored') return;
    usePlanEditorStore.getState().finishDraft({ keepArmed: event.evt.shiftKey });
  }

  function handleStageMouseMove() {
    const at = pointerInMetres();
    if (!at) return;
    const store = usePlanEditorStore.getState();
    if (store.marquee) {
      store.trackMarquee(at);
      return;
    }
    if (rubberBand) {
      setRubberBand({ ...rubberBand, current: store.previewDraftPoint(at, { pxPerMetre: transform.scale }) });
      return;
    }
    if (drawingCorners) {
      setDrawPointer(store.previewDraftPoint(at, { pxPerMetre: transform.scale }));
      return;
    }
    if (mode !== 'measure') return;
    store.trackMeasurePointer(at, { pxPerMetre: transform.scale });
  }

  /*
   * The editor's keyboard, on the window rather than on the canvas wrapper.
   *
   * It used to be the wrapper's own `onKeyDown`, so it worked only while that `div` had focus — and
   * clicking a Konva shape does not focus it, and clicking a Layers row or a palette tile moves
   * focus somewhere else. Delete after picking a row did nothing, and there was no ⌘Z at all.
   * `editorShortcut` decides whether a key press belongs to the editor or to whatever has focus;
   * this effect decides what the editor does with it.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const shortcut = editorShortcut(event, shortcutTarget(event.target));
      if (!shortcut) return;

      const run = useAiRunStore.getState();
      const runActive = selectRunActive(run);
      const store = usePlanEditorStore.getState();

      /*
       * Escape stops the designer, and it is checked before everything else.
       *
       * Escape means "stop what is happening" everywhere else in this application, and while a
       * redesign is playing the thing that is happening is the redesign — not the selection, which
       * the run is moving around on its own anyway. Checked above the guard below because that
       * guard exists to keep the user's *edits* out while the AI has the plan, and stopping it is
       * the one interaction that must work exactly then.
       */
      if (shortcut.kind === 'escape' && runActive) {
        event.preventDefault();
        run.cancel();
        return;
      }

      /* Every other shortcut is an edit like any other — see `elementsDraggable`. */
      if (runActive || run.compare === 'before') return;
      /* Mid-drag, an Undo would pop the entry before the gesture and the drag would then land on it. */
      if (store.gestureSnapshot) return;

      if (shortcut.kind === 'undo' || shortcut.kind === 'redo') {
        event.preventDefault();
        if (shortcut.kind === 'undo') store.undo();
        else store.redo();
        return;
      }

      /* The 3D editor owns Escape and the selection while it is open; only history reaches past it. */
      if (store.structureEdit) return;

      if (shortcut.kind === 'selectAll') {
        event.preventDefault();
        store.selectAll();
        return;
      }

      if (shortcut.kind === 'escape') {
        /* One level at a time: what is armed, then what is being measured, then the selection. */
        if (store.placingCategory) {
          event.preventDefault();
          /* The shape half-drawn goes first; a second Escape disarms. */
          if (store.draftPoints.length > 0) store.cancelDraft();
          else store.setPlacing(null);
          return;
        }
        if (store.mode === 'measure') {
          event.preventDefault();
          if (store.measurement) store.clearMeasurement();
          else store.setMode('select');
          return;
        }
      }

      const selectedId = store.selectedId;
      if (!selectedId) return;

      /*
       * While a shape's corners are open, Delete takes away the picked corner and Escape steps out:
       * the corner, then the editing. Delete with no corner picked does nothing rather than deleting
       * the whole shape — the same care the Edges tab takes below.
       */
      if (store.vertexEdit && store.vertexEdit.id === selectedId) {
        const { selectedIndex } = store.vertexEdit;
        if (shortcut.kind === 'delete') {
          event.preventDefault();
          if (selectedIndex !== null) store.deleteVertex(selectedId, selectedIndex);
          return;
        }
        if (shortcut.kind === 'escape') {
          event.preventDefault();
          if (selectedIndex !== null) store.selectVertex(null);
          else store.closeVertexEdit();
          return;
        }
      }

      /*
       * While a surface's edges are open, Delete and Escape belong to them. Delete takes away the
       * selected run and nothing else — deleting the whole patio because a run was not selected
       * would be the most expensive keystroke in the editor. Escape steps out one level at a time:
       * the run, then the tab.
       */
      if (store.edgeEdit && store.edgeEdit.hostId === selectedId) {
        const { selectedRunId } = store.edgeEdit;
        if (shortcut.kind === 'delete') {
          event.preventDefault();
          if (selectedRunId) store.removeEdgeRun(selectedId, selectedRunId);
          return;
        }
        if (shortcut.kind === 'escape') {
          event.preventDefault();
          if (selectedRunId) store.selectEdgeRun(null);
          else store.closeEdgeEdit();
          return;
        }
      }

      event.preventDefault();
      switch (shortcut.kind) {
        case 'delete':
          store.deleteSelection();
          return;
        case 'escape':
          store.select(null);
          return;
        case 'duplicate':
          store.duplicateSelection();
          return;
        case 'nudge':
          store.beginGesture();
          store.nudgeSelection(shortcut.dx, shortcut.dy);
          store.endGesture();
          return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /*
   * While the AI has the plan, the user's own tools are off.
   *
   * Not because two editors would fight over the geometry — the store would arbitrate that
   * perfectly well — but because a drag landing inside the run's gesture bracket would be swept
   * into the run's single undo entry, and pressing Undo afterwards would take away the user's own
   * change along with the redesign. The honest options are "watch it" or "stop it", and both are in
   * the panel.
   */
  const elementsDraggable = !aiActive && !comparing && !panActive && mode === 'select' && !placingCategory;

  /*
   * While placing, elements stop listening entirely.
   *
   * Every zone is covered by a base fill, so a click almost anywhere on the garden lands on a
   * shape — and a shape's own handler cancels the bubble to claim the selection. Leave them
   * listening and the stage's placement handler is reachable only over the house, which is now
   * a perfectly ordinary place to put a patio. Full coverage is what makes this screen's ground
   * look finished; it is also what makes this necessary.
   */
  const elementsListening =
    !aiActive && !comparing && !panActive && mode === 'select' && !placingCategory;

  return (
    <div
      data-testid="editor-canvas"
      data-renderer={richReady ? 'rich' : 'technical'}
      data-scale={transform.scale} data-offset-x={transform.offsetX + panOffset.x} data-offset-y={transform.offsetY + panOffset.y}
      className="relative h-full min-h-[420px] w-full overflow-hidden rounded-xl border border-garden-line bg-white"
    >
      <div
        ref={wrapperRef}
        role="application"
        aria-label="Garden plan. Select an element, then use the arrow keys to move it and Delete to remove it."
        tabIndex={0}
        className="absolute inset-0 focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:ring-inset focus-visible:outline-none"
        style={{
          cursor: panActive
            ? 'grabbing'
            : placingCategory || mode === 'measure'
              ? 'crosshair'
              : 'default',
        }}
      >
        {canRender ? <EditorScene scene={richScene} site={boundaryDraft}
          transform={{ ...transform, offsetX: transform.offsetX + panOffset.x, offsetY: transform.offsetY + panOffset.y }}
          onReady={setRichReady} /> : null}
        {/*
          The stage has a layer budget: three idle, four during an AI run. Konva warns above five,
          and every layer is a full-size canvas at device-pixel ratio plus a hit canvas, composited
          by the browser every frame whether or not it draws anything. The four are the backdrop
          (never listens, never animates), the elements (the only interactive one), the chrome
          (redraws on selection) and the AI's (mounted per run, the only one animating at frame
          rate). A new drawing pass goes in a `Group` inside one of those, never in a new `Layer` —
          `ai-redesign.spec.ts` counts them.
        */}
        {canRender ? (
          <Stage
            ref={stageRef}
            width={size.width}
            height={size.height}
            /* Always draggable; `handleStageDragStart` vetoes the gestures that are not pans. */
            draggable
            onClick={handleStageClick}
            onDblClick={handleStageDblClick}
            onMouseDown={handleStageMouseDown}
            onMouseUp={handleStageMouseUp}
            onDragStart={handleStageDragStart}
            onMouseMove={handleStageMouseMove}
            onDragMove={(event) => {
              if (isStageDrag(event)) setPanOffset({ x: event.target.x(), y: event.target.y() });
            }}
            onDragEnd={(event) => {
              if (isStageDrag(event)) setPanOffset({ x: 0, y: 0 });
              handleStageDragEnd(event);
            }}
            onWheel={handleWheel}
          >
            {/*
              The backdrop: graph paper and the plot outline, on one layer that never listens.

              These were two layers until the stage went past Konva's five-layer advice (see the
              budget note above). Merged rather than dropped: nothing here composites with anything
              but source-over, so one canvas paints the identical picture, and both halves were
              already `listening={false}`. The layer's own `visible` is what keeps an idle editor
              at zero composited backdrop canvases — a hidden *layer* takes its canvas out of the
              page where a hidden group does not — which is exactly what two separately hidden
              layers used to give.
            */}
            <Layer listening={false} visible={gridVisible || !richReady}>
              {/*
                Graph paper, clipped to the plot.

                Full-bleed it reads as the drawing being *on* graph paper; clipped to the boundary
                it reads as a measured surface, which is what it is for. Konva runs `beginPath`
                before the clip function and `clip` after, so this only traces the path — and it
                restores the context afterwards, which is why the plot below is unclipped.
              */}
              {gridVisible ? (
                <Group
                  clipFunc={(context) => {
                    if (polygon.length < 3) return;

                    const points = polygonToKonvaPoints(polygon, transform);
                    context.moveTo(points[0]!, points[1]!);
                    for (let i = 2; i < points.length; i += 2) {
                      context.lineTo(points[i]!, points[i + 1]!);
                    }
                    context.closePath();
                  }}
                >
                  <SquareGrid
                    transform={transform}
                    unit={unit}
                    width={size.width}
                    height={size.height}
                  />
                </Group>
              ) : null}

              {/* The property from step 1, as locked background context. */}
              <Group visible={!richReady}>
                {polygon.length >= 3 ? (
                  <Line
                    points={polygonToKonvaPoints(polygon, transform)}
                    closed
                    fill={COLOUR.fill}
                    stroke={COLOUR.stroke}
                    strokeWidth={1}
                    lineJoin="round"
                  />
                ) : null}
              </Group>
            </Layer>

            {/*
              The layout. Array order is stacking order — base fills, accent fills, then
              features — which is what keeps every chosen zone covered. See `concept-fill.ts`.

              The shadow layer is spliced in at the fill-to-feature seam rather than given a
              Layer of its own: shadows fall ON surfaces so they must sit above them, and a tree
              stands up out of the ground so it must be drawn over the shadow it casts. Slicing
              the same array preserves the ordering guarantee above; two Konva layers would not.
            */}
            <Layer>
              {passes.ground.map((element) => (
                <ElementShape
                  key={`ground-${element.id}`}
                  part="ground"
                  rich={richReady}
                  exclusions={exclusions.get(element.id)}
                  cutEdge={cutEdges.get(element.id)}
                  element={element}
                  transform={transform}
                  selected={selectedIds.includes(element.id) && element.symbol !== 'pergola'}
                  draggable={elementsDraggable && !isLocked(element) && vertexEdit?.id !== element.id}
                  listening={elementsListening}
                  light={light}
                />
              ))}

              {!richReady ? <ShadowLayer
                elements={settledElements}
                house={boundaryDraft.house}
                boundary={polygon}
                site={boundaryDraft}
                transform={transform}
              /> : null}

              {passes.objects.map((element) => (
                <ElementShape
                  key={`object-${element.id}`}
                  part={element.symbol === 'pergola' ? 'object' : 'all'}
                  rich={richReady}
                  cutEdge={cutEdges.get(element.id)}
                  element={element}
                  transform={transform}
                  selected={selectedIds.includes(element.id)}
                  draggable={elementsDraggable && !isLocked(element) && vertexEdit?.id !== element.id}
                  listening={elementsListening}
                  light={light}
                />
              ))}
            </Layer>

            {/*
              The chrome: everything drawn over the design that is not the design — the fence, the
              house, and the editor's own handles, guides and tape.
            */}
            <Layer>
              {/*
                The fence sits *above* the surfaces, not below them. A boundary drawn underneath is
                covered by the base fill that runs to the edge of the zone, which is every generated
                concept — so the garden would lose its edge exactly where it needs one.

                First child of this layer rather than a layer of its own: the same place in the
                stack, one fewer canvas. It cannot live in the elements layer — under the fills it
                is covered, over the objects it crosses a canopy that overhangs the boundary. And a
                hidden group returns from `drawScene` before it touches a child, so on the rich
                path, where the fence is never drawn, it costs nothing.
              */}
              <Group listening={false} visible={!richReady}>
                <FenceLine
                  polygon={polygon}
                  runs={[...effectiveBoundary.survey, ...effectiveBoundary.proposed]}
                  replaced={effectiveBoundary.replaced}
                  transform={transform}
                  light={light}
                  gaps={gateGaps(boundaryDraft)}
                />
              </Group>

              {!richReady && houseOutline && boundaryDraft.house ? (
                <>
                  <HouseShape
                    outline={houseOutline}
                    centre={boundaryDraft.house.centre}
                    rotation={boundaryDraft.house.rotation}
                    size={houseSize(boundaryDraft.house)}
                    unit={unit}
                    transform={transform}
                    light={light}
                  />
                  {/* The doors the generator routed its path to. Inert here: step 1 edits them. */}
                  <HouseOpenings house={boundaryDraft.house} transform={transform} />
                </>
              ) : null}

              {/* Gates in the fence and the street, so a side path visibly goes somewhere. */}
              {!richReady ? <GateMarks site={boundaryDraft} transform={transform} /> : null}

              <AlignmentLines
                guides={alignments}
                transform={transform}
                width={size.width}
                height={size.height}
              />

              {/*
                What a drag has snapped to, marked: a corner onto a corner, or a corner onto a wall.
                A flush pull against a turned house draws no axis guide at all, so without this the
                shape simply jumps and nothing says why.
              */}
              {snapMarker ? <SnapMarker at={metresToPx(snapMarker, transform)} /> : null}

              {marquee ? (
                <DraftOverlay points={[]} ghost={null} closable={false} band={marquee} transform={transform} unit={unit} />
              ) : null}

              {drawingSurface && (draftPoints.length > 0 || rubberBand) ? (
                <DraftOverlay
                  points={draftPoints}
                  ghost={drawingCorners && draftPoints.length > 0 ? drawPointer : null}
                  closable={placingTool === 'polygon' && draftPoints.length >= 3}
                  band={rubberBand}
                  transform={transform}
                  unit={unit}
                />
              ) : null}

              {/*
                Corner editing: step 2's own vertex tools, pointed at a design element. The edges
                insert a corner where they are clicked; a corner drags, and clicking one picks it for
                Delete — which is the meaning Delete already has on this canvas, rather than a click
                deleting outright on a drag that happened not to move.
              */}
              {vertexHost ? (
                <VertexEditor
                  element={vertexHost}
                  transform={transform}
                  hoveredEdge={hoveredVertexEdge}
                  onHoverEdge={setHoveredVertexEdge}
                  selectedIndex={vertexEdit?.selectedIndex ?? null}
                  listening={!panActive}
                  pointerInMetres={pointerInMetres}
                />
              ) : null}

              {/* Resize and rotate, the same handles the house and step 2's features use. */}
              {selected && single && !edgeHost && selected.shape.kind === 'rect' && !isLocked(selected) ? (
                <ShapeHandles
                  centre={selected.shape.centre}
                  rotation={selected.shape.rotation}
                  size={{ width: selected.shape.width, depth: selected.shape.depth }}
                  transform={transform}
                  resizable={!panActive}
                  minSide={MIN_ELEMENT_SIDE}
                  onResize={(next) =>
                    usePlanEditorStore.getState().resizeElementLive(selected.id, next)
                  }
                  onRotate={(degrees) =>
                    usePlanEditorStore.getState().rotateElementLive(selected.id, degrees)
                  }
                  onGestureStart={() => usePlanEditorStore.getState().beginGesture()}
                  onGestureEnd={() => usePlanEditorStore.getState().endGesture()}
                  testIdPrefix="element"
                />
              ) : null}

              {/*
                The selected surface's edges, while its Edges tab is open.

                Fragments inside this Layer, never a Layer of their own — see the layer budget note.
                Hover, add and the end handles are live in Custom only; in Auto the runs are drawn so
                the automatic answer can be inspected, and nothing on them listens.
              */}
              {edgeHost && edgeView ? (
                <Group>
                  <EdgeEditLayer
                    chains={edgeView.chains}
                    runs={edgeView.runs}
                    editable={edgeView.editable}
                    selectedRunId={edgeEdit?.selectedRunId ?? null}
                    hoveredRunId={edgeEdit?.hoveredRunId ?? null}
                    bareHover={edgeView.editable ? bareHover : null}
                    transform={transform}
                    listening={!panActive}
                    onHoverBare={(side, distance) => {
                      if (distance === null) return setBareHover(null);
                      const span = freeSpanAt(
                        edgeHost,
                        edgeView.resolution.graph.intervalsOf(edgeHost.id),
                        side,
                        distance,
                      );
                      setBareHover(span ? { side, ...span } : null);
                    }}
                    onAddAt={(side, distance) => {
                      setBareHover(null);
                      usePlanEditorStore.getState().addEdgeRunAt(edgeHost.id, side, distance);
                    }}
                    onSelectRun={(runId) => usePlanEditorStore.getState().selectEdgeRun(runId)}
                    onHoverRun={(runId) => usePlanEditorStore.getState().hoverEdgeRun(runId)}
                    onEndDragStart={() => usePlanEditorStore.getState().beginGesture()}
                    onEndDrag={(runId, end, distance) =>
                      usePlanEditorStore.getState().setEdgeRunEndLive(edgeHost.id, runId, end, distance)
                    }
                    onEndDragEnd={() => usePlanEditorStore.getState().endGesture()}
                    readEnd={(runId, end) => runEndPoint(edgeHost.id, runId, end)}
                  />
                </Group>
              ) : null}

              {/*
                The selected shape's size, on the plan.

                Outside `ShapeHandles` on purpose: that group is rotated with the shape, and a
                dimension written at 30° is a dimension nobody reads. Sitting under the shape's
                anchor it also stays put while the shape turns, so the number is legible mid-drag,
                which is exactly when it is wanted.
              */}
              {selected && single && detailed && sizeBadgeText(selected, unit) ? (
                <Label
                  at={{
                    x: metresToPx(elementAnchor(selected), transform).x,
                    y:
                      metresToPx(elementAnchor(selected), transform).y +
                      selectedBadgeOffset(selected, transform),
                  }}
                  text={sizeBadgeText(selected, unit)!}
                  tone={COLOUR.handle}
                />
              ) : null}

              {/*
                Plot dimensions, one per edge, drawn clear of the fence the way a drawing does it.
                The offset is in metres so the lines sit the same real distance out at every zoom.

                These replace the midpoint chips this screen used to draw rather than joining them:
                one guide per edge is the same set of numbers, so keeping both put two copies of
                "20.0 m" a few pixels apart on every side.
              */}
              {dimensionsVisible ? (
                <MeasurementGuides
                  guides={plotDimensionGuides(polygon, PLOT_DIMENSION_OFFSET)}
                  transform={transform}
                  unit={unit}
                />
              ) : null}

              {/*
                The selected shape's own sides, with Dimensions on or while its corners are open —
                the figures it would be set out by. One shape only: with several selected the numbers
                would describe nothing in particular.
              */}
              {selected && single && (dimensionsVisible || vertexHost) ? (
                <MeasurementGuides guides={elementDimensionGuides(selected)} transform={transform} unit={unit} />
              ) : null}

              {/*
                Room to spare, while it is being dragged: to the fence and to the nearest thing beside
                it. The reading a designer takes constantly and a freeform canvas never gives.
              */}
              {selected && single && gesturingNow ? (
                <MeasurementGuides
                  guides={clearanceGuides(selected, polygon, elements)}
                  transform={transform}
                  unit={unit}
                />
              ) : null}

              {/* The measuring tape. */}
              {measurement ? (
                <Group listening={false}>
                  <Line
                    points={[
                      metresToPx(measurement.from, transform).x,
                      metresToPx(measurement.from, transform).y,
                      metresToPx(measurement.to ?? measurement.from, transform).x,
                      metresToPx(measurement.to ?? measurement.from, transform).y,
                    ]}
                    stroke={COLOUR.handle}
                    strokeWidth={1.5}
                    dash={[6, 3]}
                  />
                  {[measurement.from, measurement.to].map((point, index) =>
                    point ? (
                      <Circle
                        key={index}
                        {...metresToPx(point, transform)}
                        radius={4}
                        fill="#ffffff"
                        stroke={COLOUR.handle}
                        strokeWidth={2}
                      />
                    ) : null,
                  )}
                  {measurement.to ? (
                    <Label
                      at={metresToPx(midpoint(measurement.from, measurement.to), transform)}
                      text={formatLength(edgeLength(measurement.from, measurement.to), unit)}
                      tone={COLOUR.handle}
                    />
                  ) : null}
                </Group>
              ) : null}
            </Layer>

            {/*
              The AI's layer, above everything the editor draws for itself, mounted only while a
              run is going on.

              `MotionGroup` holds the elements actually in flight this frame; `AiOverlayGroup` holds
              the selection, ghosts, vertices, route guides, inspection frame and cursor. They were
              a layer each until the stage went past Konva's five-layer advice; one is also the
              right shape, since they are two halves of one picture and always appear together.
              Gated on `frame` alone, which is safe because `overlaidMotion` is derived from it —
              no frame, no motion — and when there is no run this screen is exactly what it was.

              A layer of its own rather than the top of the chrome layer, though: this is the one
              thing on the canvas that animates at frame rate, and drawing it into the chrome would
              re-stroke the dimension guides' text nodes sixty times a second. Isolating that is
              what a Konva layer is for.
            */}
            {aiFrame ? (
              <Layer listening={false}>
                <MotionGroup entries={overlaidMotion} transform={transform} light={light} />
                <AiOverlayGroup frame={aiFrame} transform={transform} />
              </Layer>
            ) : null}
          </Stage>
        ) : null}
      </div>

      {/* Chrome in HTML, so it uses the same tokens and icons as the rest of the screen. */}
      <div className="pointer-events-none absolute inset-0">
        {/*
          Zones are off by default here — they are scaffolding for "which parts do you want
          designed", and writing "Back garden ~ 18 m2" across a finished design is a note about the
          tool rather than the garden. The toggle exists because a user checking their own answer
          had no way to see them again on any screen; it is off, not absent.
        */}
        {/*
          Zones and Labels are two switches over one label pass, so neither needs the other: the
          Zones switch used to do nothing unless Labels was also on, while its tooltip promised it
          would tint the gardens. One pass still lays both out, so a zone name and a feature chip
          can never land on top of each other.
        */}
        {canRender && (labelsVisible || zonesVisible) ? (
          <ConceptLabels
            elements={labelsVisible ? elements : EMPTY_ELEMENTS}
            detailed={detailed}
            transform={transform}
            size={size}
            unit={unit}
            zones={zonesVisible ? zones : undefined}
          />
        ) : null}

        {/*
          The selected run's toolbar, beside the run it is about — the reference's floating bar. HTML
          rather than Konva for the reason the AI chip is: it is text somebody reads and a button
          somebody presses. Offset out from the surface so it never sits on the handles.
        */}
        {edgeHost && edgeView?.editable && selectedEdgeRun ? (
          <EdgeRunToolbar
            at={runLabelPoint(selectedEdgeRun.points)}
            transform={transform}
            label={`${treatmentSpec(selectedEdgeRun.treatment).label} · ${formatLength(selectedEdgeRun.length, unit)}`}
            onRemove={() => {
              if (selectedEdgeRun.runId)
                usePlanEditorStore.getState().removeEdgeRun(edgeHost.id, selectedEdgeRun.runId);
            }}
          />
        ) : null}

        {edgeHost && edgeView?.editable && bareHover && !selectedEdgeRun ? (
          <span
            data-testid="edge-add-hint"
            className="absolute -translate-x-1/2 -translate-y-[140%] rounded-md border border-garden-line bg-white/95 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-garden-ink shadow-sm"
            style={hintStyle(edgeView.chains[bareHover.side], bareHover, transform)}
          >
            Click to add edging
          </span>
        ) : null}

        {/*
          The AI's own label, in HTML for the reason the size badge is: text on a canvas cannot be
          selected, scaled by the user's own font settings, or read by a screen reader.
        */}
        {aiFrame?.chip && aiFrame.cursor ? (
          <span
            data-testid="ai-label-chip"
            role="status"
            className="absolute flex items-center gap-2 rounded-sm bg-garden-forest py-1.5 pr-3 pl-2 text-xs font-semibold whitespace-nowrap text-white shadow-md"
            style={{
              left: metresToPx(aiFrame.cursor, transform).x + 26,
              top: metresToPx(aiFrame.cursor, transform).y - 34,
            }}
          >
            <span aria-hidden className="h-3.5 w-0.5 rounded-full" style={{ background: COLOUR.ai }} />
            {aiFrame.chip}
          </span>
        ) : null}

        {comparing ? (
          <p
            data-testid="ai-compare-banner"
            role="status"
            className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full border border-garden-line bg-white px-4 py-1.5 text-xs font-medium text-garden-ink shadow-sm"
          >
            Showing the plan before the AI designer&rsquo;s changes
          </p>
        ) : null}

        {clash ? (
          <p
            data-testid="editor-clash"
            role="status"
            className="absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-1.5 text-xs font-medium text-red-700 shadow-sm"
          >
            <CircleAlert aria-hidden className="h-3.5 w-3.5" />
            {clash}
          </p>
        ) : null}

        {placingCategory ? (
          <DrawToolStrip
            category={placingCategory}
            label={
              placingSymbol
                ? SYMBOLS[placingSymbol].label.toLowerCase()
                : placingEnclosure
                  ? ENCLOSURE_KINDS[placingEnclosure].label.toLowerCase()
                  : CATEGORY_COLOURS[placingCategory].label.toLowerCase()
            }
            drawable={drawingSurface}
          />
        ) : null}

        <CanvasChrome
          transform={transform}
          unit={unit}
          panning={panning}
          onZoomIn={() => zoomAbout(1.25, stageCentre)}
          onZoomOut={() => zoomAbout(0.8, stageCentre)}
          onFit={() => fitToShape(size.width, size.height)}
          onTogglePan={() => setPanning((value) => !value)}
        />
      </div>

      {/*
        Konva shapes cannot take DOM focus, so every element gets a real button. This is how the
        plan is reachable by keyboard at all; focusing one selects it.
      */}
      <ul className="sr-only">
        {elements.map((element) => (
          <li key={element.id}>
            <button
              type="button"
              data-testid={`select-element-${element.id}`}
              aria-pressed={selectedIds.includes(element.id)}
              onFocus={() => usePlanEditorStore.getState().select(element.id)}
              onClick={() => usePlanEditorStore.getState().select(element.id)}
                  >
              {element.name ?? CATEGORY_COLOURS[element.category].label}
            </button>
          </li>
        ))}
        {/*
          Konva lines are not DOM, so every run and every side gets a real button — keyboard access,
          and the only thing Playwright can aim at. The ± buttons are the keyboard's version of
          dragging an end, a tenth of a metre at a time.
        */}
        {edgeHost && edgeView?.editable
          ? edgeView.chains.map((chain) => (
              <li key={`edge-add-${chain.side}`}>
                <button
                  type="button"
                  data-testid={`canvas-edge-add-${chain.side}`}
                  onClick={() =>
                    usePlanEditorStore.getState().addEdgeRunAt(edgeHost.id, chain.side, chain.length / 2)
                  }
                >
                  Add edging to side {chain.side + 1}
                </button>
              </li>
            ))
          : null}
        {edgeHost && edgeView?.editable
          ? edgeView.runs.flatMap((run) =>
              run.runId
                ? [
                    <li key={`edge-run-${run.runId}`}>
                      <button
                        type="button"
                        data-testid={`canvas-edge-run-${run.runId}`}
                        aria-pressed={edgeEdit?.selectedRunId === run.runId}
                        onClick={() => usePlanEditorStore.getState().selectEdgeRun(run.runId)}
                      >
                        {treatmentSpec(run.treatment).label} on side {run.side + 1}
                      </button>
                      {(['from', 'to'] as const).flatMap((end) =>
                        ([-0.1, 0.1] as const).map((step) => (
                          <button
                            key={`${end}${step}`}
                            type="button"
                            data-testid={`canvas-edge-run-${run.runId}-${end}-${step > 0 ? 'out' : 'in'}`}
                            onClick={() => nudgeRunEnd(edgeHost.id, run.runId!, end, step)}
                          >
                            Move the {end === 'from' ? 'start' : 'end'} {step > 0 ? 'on' : 'back'}
                          </button>
                        )),
                      )}
                    </li>,
                  ]
                : [],
            )
          : null}
      </ul>
    </div>
  );
}

/**
 * How far outside the fence the overall dimension lines sit, in metres.
 *
 * Metres rather than pixels, so they stay the same real distance out at every zoom — the same rule
 * the fence posts and the paving joints follow. Far enough to clear the fence and its posts.
 */
const PLOT_DIMENSION_OFFSET = 0.9;

/**
 * How far under the anchor the size badge sits, in px.
 *
 * Measured from the shape's own extent rather than a flat offset, so the chip clears a large patio
 * instead of landing in the middle of it — and clamped, so it stays on screen for a surface bigger
 * than the viewport. The rotate handle lives above the shape, so the badge goes below.
 */
function selectedBadgeOffset(element: DesignElement, transform: CanvasTransform): number {
  const anchor = elementAnchor(element);
  const reach = elementOutline(element).reduce(
    (furthest, point) => Math.max(furthest, point.y - anchor.y),
    0,
  );

  return Math.min(reach * transform.scale, 140) + 18;
}

/**
 * One element, drawn in its material and draggable unless it is locked ground.
 *
 * Everything sits in a Group parked on the element's anchor, so dragging is the plain "read the
 * node's position" case — drawing from absolute points would make a drag double-count the node's
 * own offset. Step 2's `FeatureShape` does the same.
 *
 * What the element *looks like* is `ElementDrawing`, shared with step 4. This wrapper owns only
 * behaviour: the drag, the selection, and the outline drawn on top to show it.
 */
function ElementShape({
  element,
  transform,
  selected,
  draggable,
  listening,
  light,
  part,
  exclusions,
  cutEdge,
  rich = false,
}: {
  element: DesignElement;
  transform: CanvasTransform;
  selected: boolean;
  draggable: boolean;
  listening: boolean;
  /** Unit vector towards the light, resolved once per canvas so every element shares one sun. */
  light?: Point;
  part?: ElementPass;
  exclusions?: Point[][];
  cutEdge?: boolean[];
  rich?: boolean;
}) {
  /*
   * The one element whose outline is changing this frame.
   *
   * `gestureSnapshot` is non-null exactly between `beginGesture` and `endGesture`, which brackets
   * both a drag and a handle resize; and the dragged element is always the selected one, because
   * `onDragStart` selects it. Everything else on the plan keeps its outline, so it keeps its cache
   * key and costs nothing — this flag must stay narrow, or a drag would flatten the whole garden.
   */
  const gesturing = usePlanEditorStore((state) => state.gestureSnapshot !== null);
  const interacting = selected && gesturing;

  const anchor = metresToPx(elementAnchor(element), transform);
  const relative = (points: Point[]): number[] =>
    points.flatMap((point) => {
      const at = metresToPx(point, transform);
      return [at.x - anchor.x, at.y - anchor.y];
    });

  return (
    <Group
      x={anchor.x}
      y={anchor.y}
      listening={listening}
      draggable={draggable}
      onMouseDown={(event) => {
        /* A Shift-press on the ground is the start of a sweep, which belongs to the stage. */
        if (event.evt.shiftKey && isGroundLayer(element)) return;
        event.cancelBubble = true;
      }}
      /*
       * Shift-click adds to the selection or takes away from it — except the ground, which is under
       * everything and is never part of a group; a Shift-click there is the end of a sweep.
       */
      onClick={(event) => {
        event.cancelBubble = true;
        if (event.evt.shiftKey && isGroundLayer(element)) return;
        usePlanEditorStore.getState().select(element.id, { additive: event.evt.shiftKey });
      }}
      /* A double-click opens a free shape's corners, as it does on step 2. */
      onDblClick={(event) => {
        event.cancelBubble = true;
        if (geometryVertices(element.shape)) usePlanEditorStore.getState().openVertexEdit(element.id);
      }}
      onDragStart={() => {
        const store = usePlanEditorStore.getState();
        /* Dragging one of several selected moves them all; dragging anything else selects it alone. */
        if (!store.selectedIds.includes(element.id)) store.select(element.id);
        store.beginGesture();
      }}
      onDragMove={(event) => {
        const node = event.target;
        usePlanEditorStore
          .getState()
          .moveElementLive(element.id, pxToMetres({ x: node.x(), y: node.y() }, transform), {
            pxPerMetre: transform.scale,
          });
      }}
      onDragEnd={(event) => {
        const store = usePlanEditorStore.getState();
        store.endGesture();

        /*
         * A move onto the house is refused rather than clamped, which leaves the Konva node
         * where the pointer let go while the store still holds the last legal position.
         * Snapping the node back to the truth is what stops the two diverging.
         */
        const current = store.present.elements.find((candidate) => candidate.id === element.id);
        if (current) event.target.position(metresToPx(elementAnchor(current), transform));
      }}
    >
      {rich ? <Line points={relative(elementOutline(element))} closed fill="rgba(0,0,0,0)"
        hitStrokeWidth={8} strokeWidth={0} /> : <ElementDrawing
        element={element}
        transform={transform}
        offsetPx={anchor}
        light={light}
        interacting={interacting}
        part={part}
        exclusions={exclusions}
        cutEdge={cutEdge}
      />}

      {/*
        Selection is drawn *over* the element rather than by restyling it.

        The drawing is shared with step 4, which has no concept of a selection, and folding one
        into the other would mean the two screens rendering different shapes again — which is the
        whole thing this component was pulled apart to stop. An outline on top costs one more node
        and keeps the drawing a pure function of the element.
      */}
      {selected ? (
        <Line
          points={relative(elementOutline(element))}
          closed
          lineJoin="round"
          stroke={COLOUR.handle}
          strokeWidth={2.5}
          shadowColor="rgba(20, 40, 24, 0.35)"
          shadowBlur={10}
          shadowOpacity={1}
          listening={false}
        />
      ) : null}
    </Group>
  );
}

/* ---------------------------------------------------------------- edge editing */

/** Where a stored run's end actually is, read from the store — so a handle can be put back on it. */
function runEndPoint(hostId: string, runId: string, end: 'from' | 'to'): Point | null {
  const host = usePlanEditorStore.getState().present.elements.find((element) => element.id === hostId);
  if (!host) return null;
  const run = edgePlanOf(host).runs.find((candidate) => candidate.id === runId);
  if (!run) return null;
  const chain = sideChains(host.shape)[run.side];
  if (!chain) return null;
  const span = spanOfRun(chain, run);
  if (!span) return null;
  return sampleChain(chain.measure, end === 'from' ? span.from : span.to).at;
}

/**
 * The keyboard's version of dragging an end: a tenth of a metre, as one undo entry.
 *
 * Positive grows the run outward — the start moves back, the end moves on — so "on" and "back" mean
 * the same thing at either end.
 */
function nudgeRunEnd(hostId: string, runId: string, end: 'from' | 'to', step: number): void {
  const store = usePlanEditorStore.getState();
  const host = store.present.elements.find((element) => element.id === hostId);
  if (!host) return;
  const run = edgePlanOf(host).runs.find((candidate) => candidate.id === runId);
  const chain = run ? sideChains(host.shape)[run.side] : undefined;
  const span = run && chain ? spanOfRun(chain, run) : null;
  if (!span) return;

  store.beginGesture();
  store.setEdgeRunEndLive(hostId, runId, end, end === 'from' ? span.from - step : span.to + step);
  store.endGesture();
}

/** The middle of a run by length, which is where its toolbar belongs. */
function runLabelPoint(points: Point[]): Point {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += edgeLength(points[i - 1]!, points[i]!);

  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const step = edgeLength(points[i - 1]!, points[i]!);
    if (walked + step >= total / 2 && step > 0) {
      const t = (total / 2 - walked) / step;
      const a = points[i - 1]!;
      const b = points[i]!;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += step;
  }
  return points[0] ?? { x: 0, y: 0 };
}

function hintStyle(
  chain: ReturnType<typeof sideChains>[number] | undefined,
  span: { from: number; to: number },
  transform: CanvasTransform,
): React.CSSProperties {
  if (!chain) return { display: 'none' };
  const at = metresToPx(sampleChain(chain.measure, (span.from + span.to) / 2).at, transform);
  return { left: at.x, top: at.y };
}

/**
 * The selected run's floating bar: what it is, how long, and the one destructive action.
 *
 * Everything else about the run is in the inspector's Edges tab, which is where a choice between
 * seven treatments belongs. This is the reference's canvas toolbar, kept to what a person reaches
 * for while their eyes are on the plan.
 */
function EdgeRunToolbar({
  at,
  transform,
  label,
  onRemove,
}: {
  at: Point;
  transform: CanvasTransform;
  label: string;
  onRemove: () => void;
}) {
  const px = metresToPx(at, transform);

  return (
    <div
      data-testid="edge-run-toolbar"
      className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-[150%] items-center gap-1 rounded-md border border-garden-line bg-white py-1 pr-1 pl-2.5 text-[11px] font-medium whitespace-nowrap text-garden-ink shadow-md"
      style={{ left: px.x, top: px.y }}
    >
      <span>{label}</span>
      <button
        type="button"
        data-testid="edge-run-remove"
        aria-label="Remove edging from this segment"
        title="Remove edging from this segment"
        onClick={onRemove}
        className="rounded p-1 text-garden-muted hover:bg-red-50 hover:text-red-700"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

/**
 * The size badge under the selected shape. A path says how long it is as well as how wide — the
 * length is what it is laid and ordered by, and "1.2 m wide" alone never said it.
 */
function sizeBadgeText(element: DesignElement, unit: Unit): string | null {
  const { length } = elementMeasures(element);
  if (element.shape.kind === 'polyline' && length !== null) {
    return `${formatLength(length, unit)} long · ${formatLength(element.shape.width, unit)} wide`;
  }
  return describeElement(element, unit);
}

/** A small ring on the exact point a drag has snapped to. */
function SnapMarker({ at }: { at: Point }) {
  return (
    <Group x={at.x} y={at.y} listening={false}>
      <Circle radius={6} stroke={COLOUR.alignment} strokeWidth={1.5} fill="rgba(255,255,255,0.85)" />
      <Circle radius={2} fill={COLOUR.alignment} />
    </Group>
  );
}

/** A selected shape's side lengths as dimension lines, clear of its edge. */
function elementDimensionGuides(element: DesignElement): DimensionGuide[] {
  const shape = element.shape;
  if (shape.kind === 'point') return [];
  if (shape.kind === 'polyline') return pathDimensionGuides(shape.points, shape.width / 2 + 0.4);
  return plotDimensionGuides(cornersOf(shape).points, ELEMENT_DIMENSION_OFFSET, 'element');
}

/** The dragged shape's clearances to the fence and to its nearest neighbour, as dimension lines. */
function clearanceGuides(element: DesignElement, boundary: Point[], elements: DesignElement[]): DimensionGuide[] {
  const obstacles = elements
    .filter((other) => other.id !== element.id && !isGroundLayer(other))
    .map((other) => elementOutline(other));
  const { toBoundary, toNearest } = clearances(elementOutline(element), { boundary, obstacles });
  return [toBoundary, toNearest]
    .filter((gap): gap is NonNullable<typeof gap> => gap !== null && gap.distance > 0.01)
    .map((gap, index) => ({ id: `clear-${index}` as const, from: gap.from, to: gap.to, distance: gap.distance }));
}

/** How far a selected shape's dimension lines sit off its edges, in metres. */
const ELEMENT_DIMENSION_OFFSET = 0.45;
