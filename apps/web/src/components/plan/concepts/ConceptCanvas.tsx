'use client';

import { useEffect, useMemo } from 'react';
import { Group, Layer, Line, Stage } from 'react-konva';
import type Konva from 'konva';
import { boundaryEdges, draftPolygon, edgeLength, midpoint } from '@/lib/boundary-geometry';
import { COLOUR } from '@/lib/canvas-colours';
import { metresToPx, polygonToKonvaPoints, type CanvasTransform } from '@/lib/canvas-transform';
import { type DesignElement, type GeneratedConcept } from '@/lib/concepts';
import { housePolygon, houseSize } from '@/lib/house';
import { formatLength } from '@/lib/units';
import { selectZones, useBoundaryStore } from '@/state/boundary-store';
import { CanvasChrome } from '../CanvasChrome';
import { ElementDrawing } from '../ElementDrawing';
import { HouseShape } from '../HouseShape';
import { Label, SquareGrid } from '../canvas-primitives';
import { useCanvasViewport } from '../use-canvas-viewport';
import { ConceptLabels } from './ConceptLabels';

/**
 * Step 4's plan.
 *
 * The property from step 1 is drawn as locked background context — same green boundary, same
 * tan house — and the concept's elements are drawn on top of it in array order. That order is
 * load-bearing: the generator emits base fills, then accent fills, then features, so the stack
 * itself is what guarantees no chosen zone shows bare graph paper.
 *
 * Nothing here is interactive beyond pan and zoom. This screen is for choosing between
 * concepts; editing one is a later step.
 */
export function ConceptCanvas({
  concept,
  variant = 'full',
}: {
  concept: GeneratedConcept | null;
  /** `pane` drops the chrome and the edge dimensions, for the side-by-side compare grid. */
  variant?: 'full' | 'pane';
}) {
  const boundaryDraft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);

  const {
    wrapperRef,
    stageRef,
    size,
    transform,
    panning,
    setPanning,
    handleStageDragStart,
    detailed,
    canRender,
    stageCentre,
    fitToShape,
    zoomAbout,
    foldStageOffset,
    handleWheel,
  } = useCanvasViewport({
    getPolygon: () => draftPolygon(useBoundaryStore.getState().present),
  });

  const polygon = useMemo(() => draftPolygon(boundaryDraft), [boundaryDraft]);
  const zones = useMemo(() => selectZones({ present: boundaryDraft }), [boundaryDraft]);
  const houseOutline = useMemo(
    () => (boundaryDraft.house ? housePolygon(boundaryDraft.house) : null),
    [boundaryDraft.house],
  );

  const elements = concept?.elements ?? [];
  const isPane = variant === 'pane';

  /*
   * Compare panes refit whenever they are resized; the full canvas fits once and then the
   * viewport belongs to the user.
   *
   * `useCanvasViewport` deliberately fits only on first sizing, so re-fitting cannot slide the
   * plan out from under someone mid-gesture. That protection is worth nothing in a pane: ticking
   * a third concept reflows the grid from two columns to three, and a pane that kept its old fit
   * ends up drawn at a different scale from the ones beside it — which is precisely the
   * comparison the panes exist to make.
   */
  useEffect(() => {
    if (isPane) fitToShape(size.width, size.height, { immediate: true });
  }, [isPane, size.width, size.height, fitToShape]);

  return (
    <div
      data-testid={isPane ? `concept-pane-${concept?.id ?? 'empty'}` : 'concept-canvas'}
      data-concept={concept?.id ?? ''}
      className="relative h-full w-full overflow-hidden rounded-xl border border-garden-line bg-white"
    >
      <div
        ref={wrapperRef}
        role="img"
        aria-label={
          concept
            ? `${concept.name}: a generated garden plan with ${elements.length} elements`
            : 'No concept selected'
        }
        className="absolute inset-0"
        style={{ cursor: panning ? 'grabbing' : 'default' }}
      >
        {canRender ? (
          <Stage
            ref={stageRef}
            width={size.width}
            height={size.height}
            draggable
            onDragStart={handleStageDragStart}
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
            </Layer>

            {/*
              The concept itself, in emission order. Fills first and features last is not a
              cosmetic choice — it is how full coverage is guaranteed. See `concept-fill.ts`.
            */}
            <Layer listening={false}>
              {elements.map((element) => (
                <ElementShape key={element.id} element={element} transform={transform} />
              ))}
            </Layer>

            {/* The house sits above the planting so a bed can run right up to the wall. */}
            <Layer listening={false}>
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

              {/* Overall dimensions along each fence, as in the mockup. */}
              {!isPane && detailed
                ? boundaryEdges(polygon, true).map((edge) => (
                    <Label
                      key={edge.index}
                      at={metresToPx(midpoint(edge.start, edge.end), transform)}
                      text={formatLength(edgeLength(edge.start, edge.end), unit)}
                    />
                  ))
                : null}
            </Layer>
          </Stage>
        ) : null}
      </div>

      {/*
        Chrome in HTML rather than Konva, so it uses the same Tailwind tokens and lucide icons
        as the rest of the screen, positioned from the same transform.
      */}
      <div className="pointer-events-none absolute inset-0">
        {/*
          One component for both feature chips and zone names. They used to be drawn
          separately and would land on top of each other; a single collision pass is the only
          way either can know the other is there.
        */}
        {canRender && concept ? (
          <ConceptLabels
            elements={elements}
            zones={isPane ? [] : zones}
            detailed={detailed && !isPane}
            transform={transform}
            size={size}
            unit={unit}
          />
        ) : null}

        {!isPane ? (
          <CanvasChrome
            transform={transform}
            unit={unit}
            panning={panning}
            onZoomIn={() => zoomAbout(1.25, stageCentre)}
            onZoomOut={() => zoomAbout(0.8, stageCentre)}
            onFit={() => fitToShape(size.width, size.height)}
            onTogglePan={() => setPanning((value) => !value)}
          />
        ) : null}

        {!concept ? (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-garden-muted">
            Pick a concept on the left to see it here.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One element of a concept.
 *
 * Drawn by the same component the editor uses. This screen used to have its own copy that read the
 * category colour and ignored `material` entirely — so a concept card showed a flat green lawn and
 * the very next screen showed the same lawn textured. Choosing between three designs from a
 * drawing that contradicts what you get is the one place that divergence really costs something.
 *
 * Inert: the whole layer is `listening={false}`, because step 4 is for choosing between concepts,
 * not editing one.
 */
function ElementShape({
  element,
  transform,
}: {
  element: DesignElement;
  transform: CanvasTransform;
}) {
  return (
    <Group listening={false}>
      <ElementDrawing element={element} transform={transform} />
    </Group>
  );
}
