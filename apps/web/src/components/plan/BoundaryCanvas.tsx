'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage } from 'react-konva';
import type Konva from 'konva';
import { Plus } from 'lucide-react';
import {
  boundaryEdgeByVertexId,
  boundaryRuns,
  gateSegment,
  gatesOnEdge,
  houseWalls,
  openingSegment,
  openingsOnWall,
  wallSegment,
  type BoundaryVertex,
  type Point,
} from '@garden-studio/schema';
import {
  boundaryEdges,
  draftPolygon,
  edgeLength,
  edgeReflowTargets,
  midpoint,
  nextDrawPoint,
  polygonCentroid,
  vertexLabel,
} from '@/lib/boundary-geometry';
import { housePolygon, houseSize, MIN_HOUSE_SIDE } from '@/lib/house';
import { alignmentGuides, houseOffsetGuides, houseSpanGuides, sizeAnchorAt } from '@/lib/guides';
import { zoneFill } from '@/lib/zone-colours';
import { COLOUR } from '@/lib/canvas-colours';
import {
  closestPointOnSegment,
  isOnScreen,
  metresToPx,
  polygonToKonvaPoints,
  rubberBandRect,
  type CanvasTransform,
} from '@/lib/canvas-transform';
import { formatArea, formatLength, type Unit } from '@/lib/units';
import {
  selectedEdgeVertexId,
  selectedWallId,
  selectZones,
  useBoundaryStore,
} from '@/state/boundary-store';
import { AttachmentHandle } from './segments/AttachmentHandle';
import { CanvasChrome } from './CanvasChrome';
import { EdgeHitLines } from './EdgeHitLines';
import { GateMarks, gateGaps } from './GateMarks';
import { EditableVertices } from './EditableVertices';
import { HouseOpenings } from './HouseOpenings';
import { HouseShape } from './HouseShape';
import { ShadowLayer } from './ShadowLayer';
import {
  AlignmentLines,
  FenceLine,
  Label,
  MeasurementGuides,
  SizeAnchor,
  SquareGrid,
} from './canvas-primitives';
import { DRAG_THRESHOLD_PX, useCanvasViewport } from './use-canvas-viewport';

const DEFAULT_HOUSE = { width: 8, depth: 6 };

/** Arrow-key nudge in metres; Shift makes it a whole metre. */
const NUDGE = 0.1;

export function BoundaryCanvas() {
  const draft = useBoundaryStore((state) => state.present);
  const mode = useBoundaryStore((state) => state.mode);
  const boundaryTool = useBoundaryStore((state) => state.boundaryTool);
  const houseTool = useBoundaryStore((state) => state.houseTool);
  const unit = useBoundaryStore((state) => state.unit);
  const selection = useBoundaryStore((state) => state.selection);
  const hoveredEdgeIndex = useBoundaryStore((state) => state.hoveredEdgeIndex);
  const housePoints = useBoundaryStore((state) => state.housePoints);
  const snapEnabled = useBoundaryStore((state) => state.snapEnabled);
  const rightAngleSnap = useBoundaryStore((state) => state.rightAngleSnap);
  const reflowEdgeIndex = useBoundaryStore((state) => state.reflowEdgeIndex);
  const sizeAnchorVisible = useBoundaryStore((state) => state.sizeAnchorVisible);
  const measurement = useBoundaryStore((state) => state.measurement);

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
    handleStageDragEnd,
    consumePan,
    registerTap,
    isDoubleTap,
    canRender,
    stageCentre,
    fitToShape,
    zoomAbout,
    handleWheel,
    pointerInMetres,
  } = useCanvasViewport({
    getPolygon: () => draftPolygon(useBoundaryStore.getState().present),
  });

  /** Alignment lines only make sense mid-gesture, so they are shown while dragging. */
  const [dragging, setDragging] = useState(false);
  /**
   * Live preview while dragging out a house rectangle, in metres. The ref is the source of
   * truth — down, move and up can all land in one event turn, before React has re-rendered,
   * and reading the drag back out of state would see a stale value.
   */
  const rubberBandRef = useRef<{ start: Point; current: Point } | null>(null);
  const [rubberBand, setRubberBand] = useState<{ start: Point; current: Point } | null>(null);

  /** Where the next click would drop a corner — see `handleStageMouseMove`. */
  const [ghost, setGhost] = useState<Point | null>(null);
  const drawingNextCorner =
    mode === 'boundary' && boundaryTool === 'draw' && !draft.closed && draft.vertices.length > 0;

  const polygon = useMemo(() => draftPolygon(draft), [draft]);
  const edges = useMemo(() => boundaryEdges(polygon, draft.closed), [polygon, draft.closed]);
  const centroid = useMemo(() => polygonCentroid(polygon), [polygon]);
  const anchorAt = useMemo(() => sizeAnchorAt(polygon), [polygon]);
  const zones = useMemo(() => selectZones({ present: draft }), [draft]);
  const house = draft.house;
  const houseOutline = useMemo(() => (house ? housePolygon(house) : null), [house]);
  const offsetGuides = useMemo(() => houseOffsetGuides(polygon, house), [polygon, house]);
  const spanGuides = useMemo(() => houseSpanGuides(house), [house]);
  const alignments = useMemo(
    () => (dragging && snapEnabled ? alignmentGuides(polygon, house) : []),
    [dragging, snapEnabled, polygon, house],
  );

  /*
   * Closing the plot or resetting replaces the geometry wholesale rather than editing it, so
   * the viewport the user had built up no longer points at anything. Refit, otherwise the
   * shape can end up off screen.
   */
  useLayoutEffect(
    () =>
      useBoundaryStore.subscribe((state, previous) => {
        const enclosed = state.present.closed && !previous.present.closed;
        const cleared = previous.present.vertices.length > 0 && state.present.vertices.length === 0;
        if (!enclosed && !cleared) return;

        const box = wrapperRef.current?.getBoundingClientRect();
        if (box) fitToShape(Math.round(box.width), Math.round(box.height));
      }),
    [fitToShape, wrapperRef],
  );

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

    // A press on a corner or on the house is that shape's drag, not the canvas's.
    if (event.target !== event.target.getStage()) {
      armPan(false);
      return;
    }

    /*
     * Dragging empty canvas pans by default. Two tools own that gesture for themselves while
     * they are armed: dragging out the house rectangle, and clicking points to draw a shape —
     * for the latter, panning needs the double-tap-and-hold instead, so a drag can never be
     * mistaken for a corner.
     */
    const draggingOutHouse = mode === 'house' && houseTool === 'rectangle';
    const drawingPoints =
      (mode === 'boundary' && boundaryTool === 'draw' && !draft.closed) ||
      (mode === 'house' && houseTool === 'custom');

    if (drawingPoints) {
      armPan(isDoubleTap(event));
      return;
    }

    armPan(!draggingOutHouse);
    if (!draggingOutHouse) return;

    const at = pointerInMetres();
    if (!at) return;

    rubberBandRef.current = { start: at, current: at };
    setRubberBand(rubberBandRef.current);
  }

  function handleStageMouseMove() {
    if (mode === 'measure') {
      const at = pointerInMetres();
      if (at) useBoundaryStore.getState().trackMeasurePointer(at);
      return;
    }

    /*
     * The ghost of the corner the next click would place, resolved through the same
     * `nextDrawPoint` the store uses — so the preview cannot promise a position the click then
     * fails to deliver. Local state rather than the store: it changes on every mouse move and
     * nothing outside this canvas has any use for it.
     */
    if (drawingNextCorner) {
      const at = pointerInMetres();
      setGhost(
        at
          ? nextDrawPoint(draft.vertices, at, {
              gridSnap: snapEnabled,
              rightAngle: rightAngleSnap,
              unit,
            })
          : null,
      );
    } else if (ghost) {
      setGhost(null);
    }

    const band = rubberBandRef.current;
    if (!band) return;

    const at = pointerInMetres();
    if (!at) return;

    rubberBandRef.current = { ...band, current: at };
    setRubberBand(rubberBandRef.current);
  }

  function handleStageMouseUp(event: Konva.KonvaEventObject<MouseEvent>) {
    handlePointerUp(event);

    const band = rubberBandRef.current;
    if (!band) return;

    const { start, current } = band;
    rubberBandRef.current = null;
    setRubberBand(null);

    const width = Math.abs(current.x - start.x);
    const depth = Math.abs(current.y - start.y);
    const { placeHouseRectangle } = useBoundaryStore.getState();

    // Too small to be a deliberate drag, so treat it as "put a default house here".
    if (
      width * transform.scale < DRAG_THRESHOLD_PX ||
      depth * transform.scale < DRAG_THRESHOLD_PX
    ) {
      placeHouseRectangle(start, DEFAULT_HOUSE.width, DEFAULT_HOUSE.depth);
      return;
    }

    placeHouseRectangle(
      { x: (start.x + current.x) / 2, y: (start.y + current.y) / 2 },
      Math.max(MIN_HOUSE_SIDE, width),
      Math.max(MIN_HOUSE_SIDE, depth),
    );
  }

  function handleStageClick(event: Konva.KonvaEventObject<MouseEvent>) {
    // Only background clicks land here; edges and handles stop their own events.
    if (event.target !== event.target.getStage()) return;
    if (panActive) return;
    // Letting go of a pan must not drop a corner or clear the selection.
    if (consumePan()) return;

    const at = pointerInMetres();
    if (!at) return;

    // Remembered so the next press can tell a double-tap-and-hold from a fresh click.
    registerTap(event);

    const { addVertexAt, addHousePoint, addMeasurePoint, select } = useBoundaryStore.getState();

    if (mode === 'measure') {
      addMeasurePoint(at);
      return;
    }

    if (mode === 'boundary' && boundaryTool === 'draw' && !draft.closed) {
      addVertexAt(at);
      return;
    }

    if (mode === 'house' && houseTool === 'custom') {
      addHousePoint(at);
      return;
    }

    select(null);
  }

  function handleEdgeClick(edgeIndex: number) {
    const at = pointerInMetres();
    if (!at) return;

    const { insertVertexOnEdge, setBoundaryTool, select } = useBoundaryStore.getState();
    const edge = edges[edgeIndex];

    if (mode === 'boundary' && boundaryTool === 'add-point') {
      insertVertexOnEdge(edgeIndex, closestPointOnSegment(at, edge.start, edge.end));
      setBoundaryTool('move');
      return;
    }

    /*
     * Otherwise the side itself is what was clicked, and its editor opens. Keyed on the vertex the
     * edge starts at rather than on the index it happens to have: an index goes stale the moment a
     * corner is inserted, and the store speaks ids everywhere.
     */
    const startVertex = draft.vertices[edgeIndex];
    if (draft.closed && startVertex) {
      select({ kind: 'edge', edgeVertexId: startVertex.id });
      return;
    }

    select(null);
  }

  function handleVertexClick(vertexId: string, at: Point) {
    const { addVertexAt, deleteVertex, select } = useBoundaryStore.getState();

    if (mode === 'boundary' && boundaryTool === 'draw' && !draft.closed) {
      // Clicking back onto the first corner is how the polygon closes.
      addVertexAt(at);
      return;
    }

    if (mode === 'boundary' && boundaryTool === 'delete') {
      deleteVertex(vertexId);
      return;
    }

    select({ kind: 'vertex', id: vertexId });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const state = useBoundaryStore.getState();

    if (event.key === 'Escape') {
      state.clearMeasurement();
      state.select(null);
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

    if (state.selection?.kind === 'house') {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        state.removeHouse();
        return;
      }
      if (move) {
        event.preventDefault();
        state.nudgeHouse(move[0], move[1]);
      }
      return;
    }

    // Delete takes away what is hung on the property; a side or a wall is geometry and stays.
    if (state.selection?.kind === 'gate' && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      state.removeGate(state.selection.id);
      return;
    }

    if (
      state.selection?.kind === 'opening' &&
      (event.key === 'Delete' || event.key === 'Backspace')
    ) {
      event.preventDefault();
      state.removeOpening(state.selection.id);
      return;
    }

    if (state.selection?.kind !== 'vertex') return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      state.deleteVertex(state.selection.id);
      return;
    }

    if (!move) return;
    event.preventDefault();
    state.nudgeVertex(state.selection.id, move[0], move[1]);
  }

  const houseSelected = selection?.kind === 'house';
  const selectedVertexId = selection?.kind === 'vertex' ? selection.id : null;
  const houseDraggable =
    !panActive && !!house && (mode === 'select' || (mode === 'house' && houseTool === 'move'));
  const vertexDraggable =
    !panActive && mode !== 'house' && !(mode === 'boundary' && boundaryTool === 'draw');

  /*
   * A side is clickable wherever clicking one means something: in Select, which is where the
   * property is described, and in Boundary mode, where the Add point tool needs the same target.
   * Not while drawing, and not in House mode, where a stray click on a fence should not open a
   * panel about it.
   */
  const edgesListening = !panActive && (mode === 'select' || mode === 'boundary');
  const edgeVertexId = selectedEdgeVertexId({ selection, present: draft });
  const selectedEdgeIndex = edgeVertexId
    ? draft.vertices.findIndex((vertex) => vertex.id === edgeVertexId)
    : -1;
  const wallId = selectedWallId({ selection, present: draft });

  /*
   * What is draggable right now, resolved through the same functions that draw it — so a gate that
   * does not currently resolve has no handle, exactly as it has no mark. Both lists are empty
   * unless a side or a wall is being edited.
   */
  const gateHandles = useMemo(() => {
    if (!edgeVertexId) return [];
    const parent = boundaryEdgeByVertexId(draft, edgeVertexId);
    if (!parent) return [];

    return gatesOnEdge(draft, edgeVertexId).flatMap((gate) => {
      const segment = gateSegment(draft, gate);
      return segment
        ? [{ gate, segment, parent: [parent.start, parent.end] as [Point, Point] }]
        : [];
    });
  }, [draft, edgeVertexId]);

  const openingHandles = useMemo(() => {
    if (!house || !wallId) return [];
    const parent = wallSegment(house, wallId);
    if (!parent) return [];

    return openingsOnWall(house, wallId).flatMap((opening) => {
      const segment = openingSegment(house, opening);
      return segment ? [{ opening, segment, parent }] : [];
    });
  }, [house, wallId]);

  return (
    <div
      data-testid="boundary-canvas"
      className="relative h-full min-h-[420px] w-full overflow-hidden rounded-xl border border-garden-line bg-white"
    >
      <div
        ref={wrapperRef}
        role="application"
        aria-label="Property plan. Select a corner or the house, then use the arrow keys to move it and Delete to remove it."
        tabIndex={0}
        onKeyDown={handleKeyDown}
        /*
         * Absolute rather than h-full: the card's height can come from min-height alone
         * once the page grows past the viewport, and a percentage height against an auto
         * parent collapses to zero — which left the stage unrendered at tablet width.
         */
        className="absolute inset-0 focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:ring-inset focus-visible:outline-none"
        style={{
          cursor: panActive
            ? 'grabbing'
            : drawingCursor(mode, boundaryTool, houseTool, draft.closed),
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
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
            onDragEnd={handleStageDragEnd}
            onWheel={handleWheel}
          >
            <Layer listening={false}>
              <SquareGrid
                transform={transform}
                unit={unit}
                width={size.width}
                height={size.height}
              />
              {/*
                Parked beside the plot rather than pinned to a corner of the screen, so it scales
                with the drawing — see `sizeAnchorAt`. Only once the outline is closed: while the
                user is still clicking corners the bounding box moves under every click.
              */}
              {sizeAnchorVisible && draft.closed && anchorAt ? (
                <SizeAnchor at={anchorAt} transform={transform} unit={unit} />
              ) : null}

              {drawingNextCorner && ghost ? (
                <DrawGhost
                  from={draft.vertices[draft.vertices.length - 1]!}
                  to={ghost}
                  transform={transform}
                  unit={unit}
                />
              ) : null}

              {reflowEdgeIndex !== null ? (
                <ReflowHint
                  vertices={draft.vertices}
                  edgeIndex={reflowEdgeIndex}
                  transform={transform}
                />
              ) : null}

              {selectedVertexId ? (
                <SelectionGuides
                  vertex={draft.vertices.find((v) => v.id === selectedVertexId)}
                  transform={transform}
                  width={size.width}
                  height={size.height}
                />
              ) : null}
            </Layer>

            <Layer>
              {polygon.length >= 2 ? (
                <Line
                  points={polygonToKonvaPoints(polygon, transform)}
                  closed={draft.closed}
                  fill={draft.closed ? COLOUR.fill : undefined}
                  stroke={COLOUR.stroke}
                  strokeWidth={2}
                  lineJoin="round"
                  listening={false}
                />
              ) : null}

              {/*
                What each side is made of, drawn where it is set. This used to be step 5's alone,
                so a hedge chosen here changed nothing on the screen it was chosen on. Only once
                the plot is a plot: a half-drawn outline has edges but not yet sides.
              */}
              {draft.closed ? (
                <FenceLine
                  polygon={polygon}
                  runs={boundaryRuns(draft)}
                  transform={transform}
                  gaps={gateGaps(draft)}
                />
              ) : null}

              {/* Each zone tinted its own colour, faintly, so the panel swatches mean something. */}
              {zones.map((zone) => (
                <Line
                  key={zone.id}
                  points={polygonToKonvaPoints(zone.polygon, transform)}
                  closed
                  fill={zoneFill(zone.id)}
                  listening={false}
                />
              ))}

              {/*
                Shadows, above the plot and its zone tints and below everything drawn on top.

                There is no layout on step 1, so the only occluder is the house — which is exactly
                the useful thing at this stage: it shows which part of the garden the building
                shades. It is also what makes the location control in the tools panel demonstrate
                itself. Set a location and the answer appears on the same screen, rather than three
                steps later where nothing would connect it to what was just typed.
              */}
              <ShadowLayer
                elements={[]}
                house={draft.house}
                boundary={polygon}
                site={draft}
                transform={transform}
              />

              <EdgeHitLines
                edges={edges}
                transform={transform}
                hoveredIndex={edgesListening ? hoveredEdgeIndex : null}
                selectedIndex={selectedEdgeIndex}
                listening={edgesListening}
                onEdgeClick={handleEdgeClick}
                onHoverChange={(index) => useBoundaryStore.getState().hoverEdge(index)}
                testIdPrefix="boundary-edge"
              />

              {/* Dimension readouts, shown while the house is the thing being worked on. */}
              {houseOutline && (houseSelected || mode === 'house') ? (
                <>
                  <MeasurementGuides guides={offsetGuides} transform={transform} unit={unit} />
                  {/*
                    The span lines tie the four offset guides into one dimension system, but
                    their numbers are already on the house caption and in the Selected object
                    panel — a third copy would only fight the caption for the same pixels.
                  */}
                  <MeasurementGuides
                    guides={spanGuides}
                    transform={transform}
                    unit={unit}
                    showLabels={false}
                  />
                </>
              ) : null}

              <AlignmentLines
                guides={alignments}
                transform={transform}
                width={size.width}
                height={size.height}
              />

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

              {houseOutline ? (
                <HouseShape
                  outline={houseOutline}
                  centre={house!.centre}
                  rotation={house!.rotation}
                  size={houseSize(house!)}
                  unit={unit}
                  transform={transform}
                  selected={houseSelected}
                  draggable={houseDraggable}
                  resizable={houseSelected && mode === 'house' && houseTool !== 'move'}
                  onSelect={() => useBoundaryStore.getState().select({ kind: 'house' })}
                  onMoveLive={(next) => useBoundaryStore.getState().moveHouseLive(next)}
                  onResize={(next) => useBoundaryStore.getState().resizeHouseLive(next)}
                  onRotate={(degrees) => useBoundaryStore.getState().rotateHouseLive(degrees)}
                  onGestureStart={() => {
                    useBoundaryStore.getState().beginGesture();
                    setDragging(true);
                  }}
                  onGestureEnd={() => {
                    useBoundaryStore.getState().endGesture();
                    setDragging(false);
                  }}
                />
              ) : null}

              {/*
                Above the footprint, so the gaps read as holes in the wall rather than as marks
                under it. Wall picking is offered only in house mode: elsewhere the building is
                context, and a stray click on it should not open a panel about doors.
              */}
              {house ? (
                <HouseOpenings
                  house={house}
                  transform={transform}
                  selectedWallId={wallId}
                  selectedOpeningId={selection?.kind === 'opening' ? selection.id : null}
                  onSelectWall={
                    mode === 'select' || mode === 'house'
                      ? (id) => useBoundaryStore.getState().selectWall(id)
                      : undefined
                  }
                  onSelectOpening={
                    mode === 'select'
                      ? (id) => useBoundaryStore.getState().select({ kind: 'opening', id })
                      : undefined
                  }
                />
              ) : null}

              {/* Gates in the fence and the street beyond it, wherever the plan is drawn. */}
              {draft.closed ? (
                <GateMarks
                  site={draft}
                  transform={transform}
                  selectedGateId={selection?.kind === 'gate' ? selection.id : null}
                  onSelectGate={
                    mode === 'select'
                      ? (id) => useBoundaryStore.getState().select({ kind: 'gate', id })
                      : undefined
                  }
                />
              ) : null}

              {/*
                Handles for what is hung on the side or the wall being edited — not for every gate
                and door on the plan, which would put a dozen grab targets over a drawing whose
                whole job is to be read. Selecting the side is what asks for them.
              */}
              {mode === 'select'
                ? gateHandles.map(({ gate, segment, parent }) => (
                    <AttachmentHandle
                      key={gate.id}
                      testId={`gate-handle-${gate.id}`}
                      segment={segment}
                      parent={parent}
                      transform={transform}
                      listening={!panActive}
                      selected={selection?.kind === 'gate' && selection.id === gate.id}
                      onSelect={() =>
                        useBoundaryStore.getState().select({ kind: 'gate', id: gate.id })
                      }
                      onGestureStart={() => {
                        useBoundaryStore.getState().beginGesture();
                        setDragging(true);
                      }}
                      onMove={(offset) => useBoundaryStore.getState().moveGateLive(gate.id, offset)}
                      onResize={(end, at) =>
                        useBoundaryStore.getState().resizeGateLive(gate.id, end, at)
                      }
                      onGestureEnd={() => {
                        useBoundaryStore.getState().endGesture();
                        setDragging(false);
                      }}
                    />
                  ))
                : null}

              {mode === 'select'
                ? openingHandles.map(({ opening, segment, parent }) => (
                    <AttachmentHandle
                      key={opening.id}
                      testId={`opening-handle-${opening.id}`}
                      segment={segment}
                      parent={parent}
                      transform={transform}
                      listening={!panActive}
                      selected={selection?.kind === 'opening' && selection.id === opening.id}
                      onSelect={() =>
                        useBoundaryStore.getState().select({ kind: 'opening', id: opening.id })
                      }
                      onGestureStart={() => {
                        useBoundaryStore.getState().beginGesture();
                        setDragging(true);
                      }}
                      onMove={(offset) =>
                        useBoundaryStore.getState().moveOpeningLive(opening.id, offset)
                      }
                      onResize={(end, at) =>
                        useBoundaryStore.getState().resizeOpeningLive(opening.id, end, at)
                      }
                      onGestureEnd={() => {
                        useBoundaryStore.getState().endGesture();
                        setDragging(false);
                      }}
                    />
                  ))
                : null}

              {rubberBand ? (
                <Rect
                  {...rubberBandRect(rubberBand, transform)}
                  fill={COLOUR.houseFill}
                  opacity={0.7}
                  stroke={COLOUR.houseStroke}
                  strokeWidth={1.5}
                  dash={[6, 4]}
                  listening={false}
                />
              ) : null}

              {housePoints.length > 0 ? (
                <>
                  <Line
                    points={polygonToKonvaPoints(housePoints, transform)}
                    stroke={COLOUR.houseStroke}
                    strokeWidth={2}
                    dash={[6, 4]}
                    listening={false}
                  />
                  {housePoints.map((point, index) => {
                    const at = metresToPx(point, transform);
                    return (
                      <Circle
                        key={index}
                        x={at.x}
                        y={at.y}
                        radius={5}
                        fill="#ffffff"
                        stroke={COLOUR.houseStroke}
                        strokeWidth={2}
                        listening={false}
                      />
                    );
                  })}
                </>
              ) : null}

              {mode !== 'house' && draft.vertices.length > 0 ? (
                <EditableVertices
                  vertices={draft.vertices}
                  transform={transform}
                  variant="boundary"
                  selectedId={selectedVertexId}
                  draggable={vertexDraggable}
                  listening={!panActive}
                  onVertexClick={handleVertexClick}
                  onVertexDragStart={(id) => {
                    const state = useBoundaryStore.getState();
                    state.select({ kind: 'vertex', id });
                    state.beginGesture();
                    setDragging(true);
                  }}
                  onVertexDragMove={(id, at) => useBoundaryStore.getState().moveVertexLive(id, at)}
                  onVertexDragEnd={() => {
                    useBoundaryStore.getState().endGesture();
                    setDragging(false);
                  }}
                  testIdPrefix="vertex"
                />
              ) : null}
            </Layer>
          </Stage>
        ) : null}
      </div>

      {/*
        Chrome lives in HTML rather than Konva so it can use the same Tailwind tokens and
        lucide icons as the rest of the screen. It is positioned from the same transform.
      */}
      <div className="pointer-events-none absolute inset-0">
        {canRender
          ? edges.map((edge) => {
              const at = metresToPx(midpoint(edge.start, edge.end), transform);
              if (!isOnScreen(at, size)) return null;

              return (
                <span
                  key={edge.index}
                  data-testid={`edge-label-${edge.index}`}
                  style={{ left: at.x, top: at.y }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md border border-garden-line bg-white px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-garden-ink shadow-sm"
                >
                  {formatLength(edgeLength(edge.start, edge.end), unit)}
                </span>
              );
            })
          : null}

        {/* Plain text rather than a pill — these name a region, they are not controls. */}
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

        {canRender && !draft.closed && draft.vertices.length >= 3 ? (
          <button
            type="button"
            data-testid="close-shape"
            onClick={() => useBoundaryStore.getState().closeShape()}
            className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-garden-forest px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-garden-green"
          >
            Close boundary
          </button>
        ) : null}

        {canRender && mode === 'house' && houseTool === 'custom' && housePoints.length >= 3 ? (
          <button
            type="button"
            data-testid="close-house-shape"
            onClick={() => useBoundaryStore.getState().closeHouseShape()}
            className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-garden-forest px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-garden-green"
          >
            Close house outline
          </button>
        ) : null}

        {canRender && draft.closed && mode === 'boundary' ? (
          <button
            type="button"
            data-testid="add-point-button"
            aria-pressed={boundaryTool === 'add-point'}
            onClick={() =>
              useBoundaryStore
                .getState()
                .setBoundaryTool(boundaryTool === 'add-point' ? 'move' : 'add-point')
            }
            style={{
              left: metresToPx(centroid, transform).x,
              top: metresToPx(centroid, transform).y,
            }}
            className={[
              'pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm',
              boundaryTool === 'add-point'
                ? 'border-garden-green bg-garden-green text-white'
                : 'border-garden-line bg-white text-garden-ink hover:border-garden-green',
            ].join(' ')}
          >
            <Plus aria-hidden className="mr-1 inline h-3.5 w-3.5" />
            Add point
          </button>
        ) : null}

        {draft.vertices.length === 0 ? (
          <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-garden-muted">
            Click anywhere to place your first corner (A).
          </p>
        ) : null}

        {draft.closed && !house && mode === 'house' && housePoints.length === 0 ? (
          <p className="absolute inset-x-0 bottom-6 text-center text-xs text-garden-muted">
            {houseTool === 'custom'
              ? 'Click each corner of the house.'
              : 'Drag out a rectangle where the house sits, or click to drop a default one.'}
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
        Konva shapes cannot take DOM focus — they are not DOM at all — so everything selectable on
        the plan gets a parallel list of real buttons. This is how the canvas is reachable by
        keyboard, and focusing one selects it, so tabbing walks the highlight round the plan.

        The sides and the walls are here for the same reason the corners are: they became things
        you select, and a thing you can only reach by clicking a particular pixel is a thing a
        keyboard user cannot reach at all.
      */}
      <ul className="sr-only">
        {draft.closed
          ? draft.vertices.map((vertex, index) => {
              const to = (index + 1) % draft.vertices.length;

              return (
                <li key={`side-${vertex.id}`}>
                  <button
                    type="button"
                    data-testid={`side-${vertexLabel(index)}`}
                    aria-pressed={vertex.id === edgeVertexId}
                    onFocus={() =>
                      useBoundaryStore.getState().select({ kind: 'edge', edgeVertexId: vertex.id })
                    }
                    onClick={() =>
                      useBoundaryStore.getState().select({ kind: 'edge', edgeVertexId: vertex.id })
                    }
                    onKeyDown={handleKeyDown}
                  >
                    {`Side ${vertexLabel(index)} to ${vertexLabel(to)}`}
                  </button>
                </li>
              );
            })
          : null}

        {house
          ? houseWalls(house).map((wall, index) => (
              <li key={`wall-${wall.id}`}>
                <button
                  type="button"
                  data-testid={`select-wall-${wall.id}`}
                  aria-pressed={wall.id === wallId}
                  onFocus={() => useBoundaryStore.getState().selectWall(wall.id)}
                  onClick={() => useBoundaryStore.getState().selectWall(wall.id)}
                  onKeyDown={handleKeyDown}
                >
                  {`House wall ${index + 1}`}
                </button>
              </li>
            ))
          : null}

        {draft.vertices.map((vertex, index) => (
          <li key={vertex.id}>
            <button
              type="button"
              data-testid={`vertex-${vertexLabel(index)}`}
              aria-pressed={vertex.id === selectedVertexId}
              onFocus={() => useBoundaryStore.getState().select({ kind: 'vertex', id: vertex.id })}
              onClick={() => useBoundaryStore.getState().select({ kind: 'vertex', id: vertex.id })}
              onKeyDown={handleKeyDown}
            >
              {`Corner ${vertexLabel(index)}`}
            </button>
          </li>
        ))}
        {house ? (
          <li>
            <button
              type="button"
              data-testid="select-house"
              aria-pressed={houseSelected}
              onFocus={() => useBoundaryStore.getState().select({ kind: 'house' })}
              onClick={() => useBoundaryStore.getState().select({ kind: 'house' })}
              onKeyDown={handleKeyDown}
            >
              House footprint
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function drawingCursor(
  mode: string,
  boundaryTool: string,
  houseTool: string,
  closed: boolean,
): string {
  if (mode === 'measure') return 'crosshair';
  if (mode === 'boundary' && boundaryTool === 'draw' && !closed) return 'crosshair';
  if (mode === 'house' && (houseTool === 'rectangle' || houseTool === 'custom')) return 'crosshair';
  return 'default';
}

/**
 * The side the next click would draw, with its length written on it.
 *
 * Pre-commit feedback is the whole point: the old flow was commit-then-correct — click a corner,
 * read the length it turned out to be, then type the right one. Showing the number *before* the
 * click lets the user aim at it instead.
 */
function DrawGhost({
  from,
  to,
  transform,
  unit,
}: {
  from: Point;
  to: Point;
  transform: CanvasTransform;
  unit: Unit;
}) {
  const start = metresToPx(from, transform);
  const end = metresToPx(to, transform);
  const length = edgeLength(from, to);

  // Under a few pixels there is no line to see and the chip would sit on the last corner.
  if (Math.hypot(end.x - start.x, end.y - start.y) < 4) return null;

  return (
    <Group listening={false}>
      <Line
        points={[start.x, start.y, end.x, end.y]}
        stroke={COLOUR.stroke}
        strokeWidth={1.5}
        dash={[6, 4]}
        opacity={0.7}
      />
      <Circle
        x={end.x}
        y={end.y}
        radius={4}
        fill="#ffffff"
        stroke={COLOUR.stroke}
        strokeWidth={2}
      />
      <Label
        at={{ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 14 }}
        text={formatLength(length, unit)}
      />
    </Group>
  );
}

/**
 * Which corner a side-length edit pins and which one it moves.
 *
 * Changing one side of a closed polygon is genuinely ambiguous — the same number could move
 * either end, or re-solve the whole outline. Rather than explain the rule in prose, draw it: the
 * pinned corner gets a ring, the moving corner gets a filled marker and the side between them is
 * highlighted. The ambiguity stops mattering once the answer is on screen.
 */
function ReflowHint({
  vertices,
  edgeIndex,
  transform,
}: {
  vertices: BoundaryVertex[];
  edgeIndex: number;
  transform: CanvasTransform;
}) {
  const targets = edgeReflowTargets(vertices.length, edgeIndex);
  if (!targets) return null;

  const anchor = vertices[targets.anchorIndex];
  const moved = vertices[targets.movedIndex];
  if (!anchor || !moved) return null;

  const anchorPx = metresToPx(anchor, transform);
  const movedPx = metresToPx(moved, transform);

  return (
    <Group listening={false}>
      <Line
        points={[anchorPx.x, anchorPx.y, movedPx.x, movedPx.y]}
        stroke={COLOUR.handle}
        strokeWidth={3}
        opacity={0.5}
      />
      {/* Pinned: an open ring, because nothing about it changes. */}
      <Circle
        x={anchorPx.x}
        y={anchorPx.y}
        radius={7}
        stroke={COLOUR.handle}
        strokeWidth={2}
        dash={[3, 3]}
      />
      {/* Moving: solid, because this is the one that will travel. */}
      <Circle x={movedPx.x} y={movedPx.y} radius={5} fill={COLOUR.handle} />
    </Group>
  );
}

/** Dashed crosshair through the selected corner. */
function SelectionGuides({
  vertex,
  transform,
  width,
  height,
}: {
  vertex: Point | undefined;
  transform: CanvasTransform;
  width: number;
  height: number;
}) {
  if (!vertex) return null;

  const at = metresToPx(vertex, transform);

  return (
    <>
      <Line points={[0, at.y, width, at.y]} stroke={COLOUR.guide} strokeWidth={1} dash={[4, 4]} />
      <Line points={[at.x, 0, at.x, height]} stroke={COLOUR.guide} strokeWidth={1} dash={[4, 4]} />
    </>
  );
}
