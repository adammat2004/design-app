'use client';

import { useEffect, useMemo, useState } from 'react';
import { Circle, Group, Layer, Line, Stage } from 'react-konva';
import { CircleAlert } from 'lucide-react';
import {
  boundaryRuns,
  computeZones,
  lightDirection,
  SYMBOLS,
  type Point,
} from '@garden-studio/schema';
import { draftPolygon, edgeLength, midpoint } from '@/lib/boundary-geometry';
import { COLOUR } from '@/lib/canvas-colours';
import {
  metresToPx,
  polygonToKonvaPoints,
  pxToMetres,
  type CanvasTransform,
} from '@/lib/canvas-transform';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import { plotDimensionGuides } from '@/lib/guides';
import {
  describeElement,
  elementAnchor,
  elementOutline,
  isLocked,
  type DesignElement,
} from '@/lib/concepts';
import { housePolygon, houseSize } from '@/lib/house';
import { formatLength } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import {
  MIN_ELEMENT_SIDE,
  NUDGE,
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
import { EditorScene } from './EditorScene';
import { buildRenderScene } from '@/lib/render/build-scene';
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
export function EditorCanvas() {
  const [richReady, setRichReady] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const boundaryDraft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);

  /*
   * Selected raw and filtered in a memo, not through a selector.
   *
   * Zustand v5 reads through `useSyncExternalStore`, which compares snapshots by identity. A
   * selector that builds a fresh array every call — anything ending in `.filter(...)` — never
   * settles, and the render loop takes the tab down with it. Only reference-stable reads may go
   * inside the hook.
   */
  const allElements = usePlanEditorStore((state) => state.present.elements);
  const elements = useMemo(() => allElements.filter((element) => !element.hidden), [allElements]);
  const maturity = usePlanEditorStore((state) => state.maturity);
  const richScene = useMemo(() => buildRenderScene({ boundary: draftPolygon(boundaryDraft),
    house: boundaryDraft.house, site: boundaryDraft, elements }, { view: 'visualise', maturity }),
  [boundaryDraft, elements, maturity]);

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

  const selected = usePlanEditorStore(selectedElement);
  const selectedId = usePlanEditorStore((state) => state.selectedId);
  const mode = usePlanEditorStore((state) => state.mode);
  const gridVisible = usePlanEditorStore((state) => state.gridVisible);
  const labelsVisible = usePlanEditorStore((state) => state.labelsVisible);
  const zonesVisible = usePlanEditorStore((state) => state.zonesVisible);
  const dimensionsVisible = usePlanEditorStore((state) => state.dimensionsVisible);
  const placingCategory = usePlanEditorStore((state) => state.placingCategory);
  const placingSymbol = usePlanEditorStore((state) => state.placingSymbol);
  const alignments = usePlanEditorStore((state) => state.alignments);
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

  function handleStageClick() {
    // A pan that ended over empty canvas must not also clear the selection.
    if (consumePan()) return;

    const at = pointerInMetres();
    const store = usePlanEditorStore.getState();

    if (mode === 'measure') {
      if (at) store.addMeasurePoint(at);
      return;
    }

    if (placingCategory && at) {
      store.addElement(placingCategory, at);
      return;
    }

    store.select(null);
  }

  function handleStageMouseMove() {
    if (mode !== 'measure') return;
    const at = pointerInMetres();
    if (at) usePlanEditorStore.getState().trackMeasurePointer(at);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    const store = usePlanEditorStore.getState();
    if (!store.selectedId) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      store.deleteElement(store.selectedId);
      return;
    }

    if (event.key === 'Escape') {
      store.select(null);
      return;
    }

    // Arrow keys nudge; Shift makes it a whole metre, matching step 2.
    const step = event.shiftKey ? 1 : NUDGE;
    const delta: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };
    const move = delta[event.key];
    if (!move) return;

    event.preventDefault();
    store.beginGesture();
    store.nudgeSelection(move[0], move[1]);
    store.endGesture();
  }

  const elementsDraggable = !panActive && mode === 'select' && !placingCategory;

  /*
   * While placing, elements stop listening entirely.
   *
   * Every zone is covered by a base fill, so a click almost anywhere on the garden lands on a
   * shape — and a shape's own handler cancels the bubble to claim the selection. Leave them
   * listening and the stage's placement handler is reachable only over the house, which is now
   * a perfectly ordinary place to put a patio. Full coverage is what makes this screen's ground
   * look finished; it is also what makes this necessary.
   */
  const elementsListening = !panActive && mode === 'select' && !placingCategory;

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
        onKeyDown={handleKeyDown}
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
        {canRender ? (
          <Stage
            ref={stageRef}
            width={size.width}
            height={size.height}
            /* Always draggable; `handleStageDragStart` vetoes the gestures that are not pans. */
            draggable
            onClick={handleStageClick}
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
              Graph paper, clipped to the plot.

              Full-bleed it reads as the drawing being *on* graph paper; clipped to the boundary it
              reads as a measured surface, which is what it is for. Konva runs `beginPath` before
              the clip function and `clip` after, so this only traces the path.
            */}
            {gridVisible ? (
              <Layer listening={false}>
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
              </Layer>
            ) : null}

            {/* The property from step 1, as locked background context. */}
            <Layer listening={false} visible={!richReady}>
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
                  element={element}
                  transform={transform}
                  selected={element.id === selectedId && element.symbol !== 'pergola'}
                  draggable={elementsDraggable && !isLocked(element)}
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
                  element={element}
                  transform={transform}
                  selected={element.id === selectedId}
                  draggable={elementsDraggable && !isLocked(element)}
                  listening={elementsListening}
                  light={light}
                />
              ))}
            </Layer>

            {/*
              The fence sits *above* the surfaces, not below them. A boundary drawn underneath is
              covered by the base fill that runs to the edge of the zone, which is every generated
              concept — so the garden would lose its edge exactly where it needs one.
            */}
            <Layer listening={false} visible={!richReady}>
              <FenceLine
                polygon={polygon}
                runs={boundaryRuns(boundaryDraft)}
                transform={transform}
                light={light}
                gaps={gateGaps(boundaryDraft)}
              />
            </Layer>

            <Layer>
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

              {/* Resize and rotate, the same handles the house and step 2's features use. */}
              {selected && selected.shape.kind === 'rect' && !isLocked(selected) ? (
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
                The selected shape's size, on the plan.

                Outside `ShapeHandles` on purpose: that group is rotated with the shape, and a
                dimension written at 30° is a dimension nobody reads. Sitting under the shape's
                anchor it also stays put while the shape turns, so the number is legible mid-drag,
                which is exactly when it is wanted.
              */}
              {selected && detailed && describeElement(selected, unit) ? (
                <Label
                  at={{
                    x: metresToPx(elementAnchor(selected), transform).x,
                    y:
                      metresToPx(elementAnchor(selected), transform).y +
                      selectedBadgeOffset(selected, transform),
                  }}
                  text={describeElement(selected, unit)!}
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
        {canRender && labelsVisible ? (
          <ConceptLabels
            elements={elements}
            detailed={detailed}
            transform={transform}
            size={size}
            unit={unit}
            zones={zonesVisible ? zones : undefined}
          />
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
          <p className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-garden-forest px-4 py-1.5 text-xs font-semibold text-white shadow-sm">
            Click the plan to place{' '}
            {placingSymbol
              ? SYMBOLS[placingSymbol].label.toLowerCase()
              : CATEGORY_COLOURS[placingCategory].label.toLowerCase()}
          </p>
        ) : null}

        <button
          type="button"
          className="absolute right-4 top-4 rounded-lg border border-garden-line bg-white px-3 py-2 text-xs text-garden-ink shadow-sm"
          onClick={() => {
            const features = elements.filter(
              (element) => !element.hidden && element.role === 'feature' && element.zone === 'back',
            );
            fitToShape(size.width, size.height, {
              polygon: features.length ? features.flatMap(elementOutline) : polygon,
            });
          }}
        >
          Fit garden
        </button>
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
              aria-pressed={element.id === selectedId}
              onFocus={() => usePlanEditorStore.getState().select(element.id)}
              onClick={() => usePlanEditorStore.getState().select(element.id)}
              onKeyDown={handleKeyDown}
            >
              {element.name ?? CATEGORY_COLOURS[element.category].label}
            </button>
          </li>
        ))}
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
        event.cancelBubble = true;
      }}
      onClick={(event) => {
        event.cancelBubble = true;
        usePlanEditorStore.getState().select(element.id);
      }}
      onDragStart={() => {
        const store = usePlanEditorStore.getState();
        store.select(element.id);
        store.beginGesture();
      }}
      onDragMove={(event) => {
        const node = event.target;
        usePlanEditorStore
          .getState()
          .moveElementLive(element.id, pxToMetres({ x: node.x(), y: node.y() }, transform));
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
