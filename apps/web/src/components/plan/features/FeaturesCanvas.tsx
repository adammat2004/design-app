'use client';

import { useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage } from 'react-konva';
import type Konva from 'konva';
import { CircleAlert } from 'lucide-react';
import type { Point } from '@garden-studio/schema';
import { boundaryEdges, draftPolygon, edgeLength, midpoint } from '@/lib/boundary-geometry';
import { COLOUR } from '@/lib/canvas-colours';
import {
  closestPointOnSegment,
  isOnScreen,
  metresToPx,
  polygonToKonvaPoints,
  pxToMetres,
  rubberBandRect,
  type CanvasTransform,
} from '@/lib/canvas-transform';
import { STATUS_COLOURS } from '@/lib/feature-colours';
import {
  FEATURE_DEFINITIONS,
  featureAnchor,
  featureBounds,
  featureOutline,
  featureVertices,
  MIN_FEATURE_SIDE,
  minimumDraftPoints,
  type PlacedFeature,
  type Placement,
} from '@/lib/features';
import { housePolygon, houseSize } from '@/lib/house';
import { formatArea, formatLength } from '@/lib/units';
import { zoneFill } from '@/lib/zone-colours';
import { selectZones, useBoundaryStore } from '@/state/boundary-store';
import { NUDGE, selectedFeatures, useFeaturesStore } from '@/state/features-store';
import { CanvasChrome } from '../CanvasChrome';
import { EdgeHitLines } from '../EdgeHitLines';
import { HouseShape } from '../HouseShape';
import { EditableVertices } from '../EditableVertices';
import { ShapeHandles } from '../ShapeHandles';
import { AlignmentLines, Label, SquareGrid } from '../canvas-primitives';
import { DRAG_THRESHOLD_PX, useCanvasViewport } from '../use-canvas-viewport';
import { FeatureLabels } from './FeatureLabels';
import { FeatureStatusPopover } from './FeatureStatusPopover';

/**
 * Step 2's plan. The property from step 1 is drawn as locked background context — same green
 * boundary, same tan house, same tinted zones — and everything interactive on top of it is an
 * existing feature.
 */
export function FeaturesCanvas() {
  const boundaryDraft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);

  const features = useFeaturesStore((state) => state.present.features);
  const mode = useFeaturesStore((state) => state.mode);
  const placingKind = useFeaturesStore((state) => state.placingKind);
  const draftPoints = useFeaturesStore((state) => state.draftPoints);
  const selectedIds = useFeaturesStore((state) => state.selectedIds);
  const editingShapeId = useFeaturesStore((state) => state.editingShapeId);
  const marquee = useFeaturesStore((state) => state.marquee);
  const alignments = useFeaturesStore((state) => state.alignments);
  const measurement = useFeaturesStore((state) => state.measurement);
  const clash = useFeaturesStore((state) => state.clash);

  const {
    wrapperRef,
    stageRef,
    size,
    transform,
    panning,
    panActive,
    setPanning,
    handlePointerDown,
    handlePointerUp,
    armPan,
    handleStageDragStart,
    consumePan,
    registerTap,
    isDoubleTap,
    detailed,
    canRender,
    stageCentre,
    fitToShape,
    zoomAbout,
    foldStageOffset,
    handleWheel,
    pointerInMetres,
  } = useCanvasViewport({
    getPolygon: () => draftPolygon(useBoundaryStore.getState().present),
  });

  /**
   * Live preview while dragging out a rectangle, in metres. The ref is the source of truth —
   * down, move and up can all land in one event turn, before React has re-rendered.
   */
  const rubberBandRef = useRef<{ start: Point; current: Point } | null>(null);
  const [rubberBand, setRubberBand] = useState<{ start: Point; current: Point } | null>(null);

  /** Reshaping chrome. Purely about what the pointer is over, so it stays out of the store. */
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);

  const polygon = useMemo(() => draftPolygon(boundaryDraft), [boundaryDraft]);
  const zones = useMemo(() => selectZones({ present: boundaryDraft }), [boundaryDraft]);
  const houseOutline = useMemo(
    () => (boundaryDraft.house ? housePolygon(boundaryDraft.house) : null),
    [boundaryDraft.house],
  );

  const placement: Placement | null = placingKind
    ? FEATURE_DEFINITIONS[placingKind].placement
    : null;
  const selection = useMemo(
    () => selectedFeatures({ present: { features }, selectedIds }),
    [features, selectedIds],
  );
  const editing = features.find((feature) => feature.id === editingShapeId) ?? null;
  const editingVertices = editing ? featureVertices(editing) : null;
  const drafting = mode === 'place' && (placement === 'polygon' || placement === 'polyline');

  /** Where the status popover hangs: on the one selection, or over the group's middle. */
  const popoverAnchor = useMemo(() => {
    if (selection.length === 0) return null;
    if (selection.length === 1) return featureAnchor(selection[0]);

    // Under the middle of everything selected, so the card never covers one member's shape.
    const boxes = selection.map(featureBounds);
    const minX = Math.min(...boxes.map((box) => box.minX));
    const maxX = Math.max(...boxes.map((box) => box.minX + box.width));
    const maxY = Math.max(...boxes.map((box) => box.minY + box.length));

    return { x: (minX + maxX) / 2, y: maxY };
  }, [selection]);

  /** True while a marquee drag is in flight, so the click that ends it does not clear it. */
  const marqueeDragged = useRef(false);
  function handleStageMouseDown(event: Konva.KonvaEventObject<MouseEvent>) {
    // A middle click starts a pan wherever it lands, so it is claimed before anything else.
    if (handlePointerDown(event)) {
      armPan(true);
      return;
    }

    if (panActive) {
      armPan(true);
      return;
    }

    // A press that lands on a feature is that feature's drag, not the canvas's.
    if (event.target !== event.target.getStage()) {
      armPan(false);
      return;
    }

    const at = pointerInMetres();
    if (!at) return;

    /*
     * While placing, a plain click has to keep meaning "put a point here", so panning needs a
     * gesture of its own: tap once more on the spot you just clicked and hold. The second press
     * arms the pan and the click it belongs to is swallowed, leaving the part-drawn shape alone.
     */
    if (mode === 'place') {
      const doubleTapped = isDoubleTap(event);
      armPan(doubleTapped);

      if (placement === 'rect' && !doubleTapped) {
        rubberBandRef.current = { start: at, current: at };
        setRubberBand(rubberBandRef.current);
      }
      return;
    }

    if (mode === 'select') {
      /*
       * Plain drag pans; Shift+drag sweeps a selection box. Shift already means "extend the
       * selection" on a click here and in the placed list, so the box adds to what is selected
       * rather than replacing it.
       */
      if (event.evt.shiftKey) {
        armPan(false);
        marqueeDragged.current = false;
        useFeaturesStore.getState().beginMarquee(at);
      } else {
        armPan(true);
      }
      return;
    }

    // Measure mode: the tape is placed by clicking, so dragging is free to pan.
    armPan(true);
  }

  function handleStageMouseMove() {
    if (mode === 'measure') {
      const at = pointerInMetres();
      if (at) useFeaturesStore.getState().trackMeasurePointer(at);
      return;
    }

    const at = pointerInMetres();
    if (!at) return;

    if (useFeaturesStore.getState().marquee) {
      marqueeDragged.current = true;
      useFeaturesStore.getState().trackMarquee(at);
      return;
    }

    const band = rubberBandRef.current;
    if (!band) return;

    rubberBandRef.current = { ...band, current: at };
    setRubberBand(rubberBandRef.current);
  }

  function handleStageMouseUp(event: Konva.KonvaEventObject<MouseEvent>) {
    handlePointerUp(event);

    if (useFeaturesStore.getState().marquee) {
      // A press with no movement is a click on empty space, not a selection sweep.
      if (marqueeDragged.current) useFeaturesStore.getState().commitMarquee();
      else useFeaturesStore.setState({ marquee: null });
      return;
    }

    const band = rubberBandRef.current;
    if (!band) return;

    const { start, current } = band;
    rubberBandRef.current = null;
    setRubberBand(null);

    if (!placingKind) return;
    const definition = FEATURE_DEFINITIONS[placingKind];
    const width = Math.abs(current.x - start.x);
    const depth = Math.abs(current.y - start.y);

    // Too small to be a deliberate drag, so treat it as "put a default one here".
    if (
      width * transform.scale < DRAG_THRESHOLD_PX ||
      depth * transform.scale < DRAG_THRESHOLD_PX
    ) {
      useFeaturesStore
        .getState()
        .placeRectangle(start, definition.size.width ?? 1, definition.size.depth ?? 1);
      return;
    }

    useFeaturesStore
      .getState()
      .placeRectangle(
        { x: (start.x + current.x) / 2, y: (start.y + current.y) / 2 },
        Math.max(MIN_FEATURE_SIDE, width),
        Math.max(MIN_FEATURE_SIDE, depth),
      );
  }

  function handleStageClick(event: Konva.KonvaEventObject<MouseEvent>) {
    // Only background clicks land here; features stop their own events.
    if (event.target !== event.target.getStage()) return;
    if (panActive) return;
    // Letting go of a pan must not drop a vertex or clear the selection.
    if (consumePan()) return;
    // The click that ends a marquee sweep must not immediately clear what it just selected.
    if (marqueeDragged.current) {
      marqueeDragged.current = false;
      return;
    }

    const at = pointerInMetres();
    if (!at) return;

    // Remembered so the next press can tell a double-tap-and-hold from a fresh click.
    registerTap(event);

    const state = useFeaturesStore.getState();

    if (mode === 'measure') {
      state.addMeasurePoint(at);
      return;
    }

    if (mode === 'place' && placement === 'point') {
      state.placePointAt(at);
      return;
    }

    if (drafting) {
      state.addDraftPoint(at);
      return;
    }

    state.select(null);
  }

  function handleStageDoubleClick() {
    // A double click is how a path or fence says "that is the end of it".
    if (placement === 'polyline' && draftPoints.length >= minimumDraftPoints('polyline')) {
      useFeaturesStore.getState().finishDraft();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const state = useFeaturesStore.getState();

    if (event.key === 'Escape') {
      state.clearMeasurement();
      state.cancelPlacing();
      setSelectedVertex(null);
      // Escape backs out one layer at a time: first out of reshaping, then out of the selection.
      if (state.editingShapeId) state.setEditingShape(null);
      else state.select(null);
      return;
    }

    if (state.selectedIds.length === 0) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();

      // While reshaping, Delete means the picked corner, not the whole feature.
      if (state.editingShapeId && selectedVertex !== null) {
        state.deleteVertex(state.editingShapeId, selectedVertex);
        setSelectedVertex(null);
        return;
      }

      state.deleteSelection();
      return;
    }

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
    state.nudgeSelection(move[0], move[1]);
  }

  const featuresDraggable = !panActive && mode === 'select';

  return (
    <div
      data-testid="features-canvas"
      className="relative h-full min-h-[420px] w-full overflow-hidden rounded-xl border border-garden-line bg-white"
    >
      <div
        ref={wrapperRef}
        role="application"
        aria-label="Garden plan. Select a feature, then use the arrow keys to move it and Delete to remove it."
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="absolute inset-0 focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:ring-inset focus-visible:outline-none"
        style={{
          cursor: panActive ? 'grabbing' : mode === 'select' ? 'default' : 'crosshair',
        }}
      >
        {canRender ? (
          <Stage
            ref={stageRef}
            width={size.width}
            height={size.height}
            /* Always draggable; `handleStageDragStart` vetoes the gestures that are not pans. */
            draggable
            onClick={handleStageClick}
            onDragStart={handleStageDragStart}
            onDblClick={handleStageDoubleClick}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
            onDragEnd={(event) => foldStageOffset(event.target as Konva.Stage)}
            onWheel={handleWheel}
          >
            <Layer listening={false}>
              <SquareGrid
                transform={transform}
                unit={unit}
                width={size.width}
                height={size.height}
              />
            </Layer>

            {/* The property, exactly as step 1 left it, and entirely inert. */}
            <Layer listening={false}>
              {polygon.length >= 3 ? (
                <Line
                  points={polygonToKonvaPoints(polygon, transform)}
                  closed
                  fill={COLOUR.fill}
                  stroke={COLOUR.stroke}
                  strokeWidth={2}
                  lineJoin="round"
                />
              ) : null}

              {zones.map((zone) => (
                <Line
                  key={zone.id}
                  points={polygonToKonvaPoints(zone.polygon, transform)}
                  closed
                  fill={zoneFill(zone.id)}
                />
              ))}

              {houseOutline && boundaryDraft.house ? (
                <HouseShape
                  outline={houseOutline}
                  centre={boundaryDraft.house.centre}
                  rotation={boundaryDraft.house.rotation}
                  size={houseSize(boundaryDraft.house)}
                  unit={unit}
                  transform={transform}
                />
              ) : null}
            </Layer>

            <Layer>
              <AlignmentLines
                guides={alignments}
                transform={transform}
                width={size.width}
                height={size.height}
              />

              {features.map((feature) => (
                <FeatureShape
                  key={feature.id}
                  feature={feature}
                  transform={transform}
                  selected={selectedIds.includes(feature.id)}
                  // A shape being reshaped is driven by its vertices, not by dragging its body.
                  draggable={featuresDraggable && feature.id !== editingShapeId}
                  listening={!panActive}
                />
              ))}

              {/* Resize and rotate, the same handles the house footprint uses on step 1. */}
              {selection.length === 1 &&
              selection[0].geometry.kind === 'rect' &&
              (detailed || selectedIds.includes(selection[0].id)) ? (
                <ShapeHandles
                  centre={selection[0].geometry.centre}
                  rotation={selection[0].geometry.rotation}
                  size={{
                    width: selection[0].geometry.width,
                    depth: selection[0].geometry.depth,
                  }}
                  transform={transform}
                  resizable={!panActive}
                  minSide={MIN_FEATURE_SIDE}
                  onResize={(next) =>
                    useFeaturesStore.getState().resizeFeatureLive(selection[0].id, next)
                  }
                  onRotate={(degrees) =>
                    useFeaturesStore.getState().rotateFeatureLive(selection[0].id, degrees)
                  }
                  onGestureStart={() => useFeaturesStore.getState().beginGesture()}
                  onGestureEnd={() => useFeaturesStore.getState().endGesture()}
                  testIdPrefix="feature"
                />
              ) : null}

              {/* Reshaping: the boundary's own vertex tools, pointed at a feature. */}
              {editing && editingVertices && (detailed || selectedIds.includes(editing.id)) ? (
                <>
                  <EdgeHitLines
                    edges={boundaryEdges(editingVertices, editing.geometry.kind === 'polygon')}
                    transform={transform}
                    hoveredIndex={hoveredEdge}
                    listening={!panActive}
                    highlight={STATUS_COLOURS[editing.status].stroke}
                    onHoverChange={setHoveredEdge}
                    onEdgeClick={(index) => {
                      const at = pointerInMetres();
                      if (!at) return;
                      const edge = boundaryEdges(
                        editingVertices,
                        editing.geometry.kind === 'polygon',
                      )[index];
                      useFeaturesStore
                        .getState()
                        .insertVertex(
                          editing.id,
                          index,
                          closestPointOnSegment(at, edge.start, edge.end),
                        );
                    }}
                    testIdPrefix="feature-edge"
                  />
                  <EditableVertices
                    vertices={editingVertices.map((point, index) => ({
                      id: String(index),
                      ...point,
                    }))}
                    transform={transform}
                    variant="feature"
                    selectedId={selectedVertex === null ? null : String(selectedVertex)}
                    draggable={!panActive}
                    listening={!panActive}
                    onVertexDragStart={() => useFeaturesStore.getState().beginGesture()}
                    onVertexDragMove={(id, at) =>
                      useFeaturesStore.getState().moveVertexLive(editing.id, Number(id), at)
                    }
                    onVertexDragEnd={() => useFeaturesStore.getState().endGesture()}
                    /*
                     * Clicking picks a corner and Delete removes it — the meaning Delete
                     * already has on this canvas — rather than clicking deleting outright,
                     * which would fire on any drag that happened not to move.
                     */
                    onVertexClick={(id) => setSelectedVertex(Number(id))}
                    testIdPrefix="feature-vertex"
                  />
                </>
              ) : null}

              {/* The shape being traced out, before it becomes a feature. */}
              {draftPoints.length > 0 ? (
                <>
                  <Line
                    points={polygonToKonvaPoints(draftPoints, transform)}
                    closed={false}
                    stroke={COLOUR.handle}
                    strokeWidth={2}
                    dash={[6, 4]}
                    listening={false}
                  />
                  {draftPoints.map((point, index) => {
                    const at = metresToPx(point, transform);
                    return (
                      <Circle
                        key={index}
                        x={at.x}
                        y={at.y}
                        radius={5}
                        fill="#ffffff"
                        stroke={COLOUR.handle}
                        strokeWidth={2}
                        listening={false}
                      />
                    );
                  })}
                </>
              ) : null}

              {rubberBand ? (
                <Rect
                  {...rubberBandRect(rubberBand, transform)}
                  fill={STATUS_COLOURS.keep.fill}
                  stroke={STATUS_COLOURS.keep.stroke}
                  strokeWidth={1.5}
                  dash={[6, 4]}
                  listening={false}
                />
              ) : null}

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

              {/* The selection sweep. Same dashed rectangle the placement tool draws. */}
              {marquee ? (
                <Rect
                  {...rubberBandRect(marquee, transform)}
                  fill="rgba(47, 122, 62, 0.08)"
                  stroke={COLOUR.stroke}
                  strokeWidth={1}
                  dash={[4, 4]}
                  listening={false}
                />
              ) : null}
            </Layer>
          </Stage>
        ) : null}
      </div>

      {/*
        Chrome in HTML rather than Konva so it can use the same Tailwind tokens and lucide icons
        as the rest of the screen, positioned from the same transform.
      */}
      <div className="pointer-events-none absolute inset-0">
        {canRender ? (
          <FeatureLabels
            features={features}
            selectedIds={selectedIds}
            detailed={detailed}
            transform={transform}
            size={size}
            unit={unit}
          />
        ) : null}

        {canRender
          ? zones.map((zone) => {
              const at = metresToPx(zone.centroid, transform);
              if (!isOnScreen(at, size)) return null;

              return (
                <span
                  key={zone.id}
                  data-testid={`zone-label-${zone.id}`}
                  style={{ left: at.x, top: at.y }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 text-center leading-tight whitespace-nowrap"
                >
                  <span className="block text-[13px] font-semibold text-garden-forest">
                    {zone.label}
                  </span>
                  <span className="block text-[11px] text-garden-muted">
                    ≈ {formatArea(zone.area, unit)}
                  </span>
                </span>
              );
            })
          : null}

        {canRender && popoverAnchor ? (
          <FeatureStatusPopover
            selection={selection}
            editing={editingShapeId !== null}
            at={metresToPx(popoverAnchor, transform)}
            bounds={size}
          />
        ) : null}

        {drafting && placement && draftPoints.length >= minimumDraftPoints(placement) ? (
          <button
            type="button"
            data-testid="finish-feature"
            onClick={() => useFeaturesStore.getState().finishDraft()}
            className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-garden-forest px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-garden-green"
          >
            {placement === 'polygon' ? 'Close shape' : 'Finish line'}
          </button>
        ) : null}

        {clash ? (
          <p
            data-testid="feature-house-clash"
            role="status"
            className="absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-1.5 text-xs font-medium text-red-700 shadow-sm"
          >
            <CircleAlert aria-hidden className="h-3.5 w-3.5" />
            {clash}
          </p>
        ) : null}

        {features.length === 0 && !placingKind ? (
          <p className="absolute inset-x-0 bottom-16 text-center text-xs text-garden-muted">
            Pick a feature type on the left, then click the plan to place it.
          </p>
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
        Konva shapes cannot take DOM focus, so every feature gets a real button. This is how the
        plan is reachable by keyboard at all; focusing one selects it, so tabbing walks the
        highlight round the garden.
      */}
      <ul className="sr-only">
        {features.map((feature) => (
          <li key={feature.id}>
            <button
              type="button"
              data-testid={`select-feature-${feature.id}`}
              aria-pressed={selectedIds.includes(feature.id)}
              onFocus={() => useFeaturesStore.getState().select(feature.id)}
              onClick={() => useFeaturesStore.getState().select(feature.id)}
              onKeyDown={handleKeyDown}
            >
              {`${feature.name}, ${STATUS_COLOURS[feature.status].label}`}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One placed feature, drawn in its status colour. Which Konva shape it becomes depends on how
 * it was placed: a true circle for a tree, a closed outline for a patio, a stroked line for a
 * path — the strip approximation used for hit-testing never reaches the screen.
 *
 * Everything sits in a Group parked on the feature's anchor, with its points expressed relative
 * to that, so dragging is the plain "read the node's position" case the boundary corners
 * already use. Drawing from absolute points instead would make a drag double-count the node's
 * own offset.
 */
function FeatureShape({
  feature,
  transform,
  selected,
  draggable,
  listening,
}: {
  feature: PlacedFeature;
  transform: CanvasTransform;
  selected: boolean;
  draggable: boolean;
  listening: boolean;
}) {
  const style = STATUS_COLOURS[feature.status];
  const { geometry } = feature;

  const anchor = metresToPx(featureAnchor(feature), transform);
  const relative = (points: Point[]): number[] =>
    points.flatMap((point) => {
      const at = metresToPx(point, transform);
      return [at.x - anchor.x, at.y - anchor.y];
    });

  const common = {
    stroke: style.stroke,
    strokeWidth: selected ? 3 : 2,
    dash: style.dash,
    shadowColor: 'rgba(20, 40, 24, 0.35)',
    shadowBlur: selected ? 10 : 0,
    shadowOpacity: 1,
  };

  return (
    <Group
      x={anchor.x}
      y={anchor.y}
      opacity={style.opacity}
      listening={listening}
      draggable={draggable}
      onMouseDown={(event) => {
        event.cancelBubble = true;
      }}
      onClick={(event) => {
        event.cancelBubble = true;
        // Shift adds to or removes from the selection; a plain click replaces it.
        useFeaturesStore.getState().select(feature.id, { additive: event.evt.shiftKey });
      }}
      onDblClick={(event) => {
        event.cancelBubble = true;
        // Only shapes with corners have anything to reshape.
        if (featureVertices(feature)) useFeaturesStore.getState().setEditingShape(feature.id);
      }}
      onDragStart={() => {
        const state = useFeaturesStore.getState();
        // Dragging something outside the selection starts a fresh one; dragging a member of it
        // moves the whole group.
        if (!state.selectedIds.includes(feature.id)) state.select(feature.id);
        state.beginGesture();
      }}
      onDragMove={(event) => {
        const node = event.target;
        useFeaturesStore
          .getState()
          .moveFeatureLive(feature.id, pxToMetres({ x: node.x(), y: node.y() }, transform));
      }}
      onDragEnd={(event) => {
        const state = useFeaturesStore.getState();
        state.endGesture();

        /*
         * A move onto the house is refused rather than clamped, which leaves the Konva node
         * sitting where the pointer let go while the store still holds the last legal
         * position. Snapping the node back to the truth is what stops the two diverging.
         */
        const current = state.present.features.find((candidate) => candidate.id === feature.id);
        if (current) event.target.position(metresToPx(featureAnchor(current), transform));
      }}
    >
      {geometry.kind === 'point' ? (
        <Circle
          {...common}
          radius={Math.max(6, geometry.radius * transform.scale)}
          fill={style.fill}
        />
      ) : geometry.kind === 'polyline' ? (
        <Line
          {...common}
          points={relative(geometry.points)}
          strokeWidth={Math.max(3, geometry.width * transform.scale)}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(14, geometry.width * transform.scale)}
        />
      ) : (
        <Line
          {...common}
          points={relative(featureOutline(feature))}
          closed
          fill={style.fill}
          lineJoin="round"
        />
      )}
    </Group>
  );
}
